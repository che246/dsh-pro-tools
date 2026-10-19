// >>> dsh-pro-tools desktop host v2
// Canonical source: dsh-pro-tools/desktop/tray-hook.js — injected into the
// desktop shell by `node desktop/apply-desktop-hook.mjs`.
//
// This region is a *host*, not a feature: it loads the dsh-pro-tools desktop
// plugin from <DSH_HOME>/pro-tools/desktop/plugin.cjs, asks it for tray rows for
// the published switch state, merges them into the shell's own tray menu, and
// routes clicks back into the plugin. Everything a future desktop feature needs
// lives in that plugin file; this region only has to stay forward compatible.
//
// It may only use identifiers main.js already provides: createRequire, join,
// readFileSync, lstatSync, homedir, Menu, app, shell, dialog, Notification,
// BrowserWindow, setInterval, plus module-scope helpers currentDesktopLocale,
// focusPrimaryWindow, quitWithoutConfirmation and the `tray` variable.
var dshProToolsDesktop = (function createDshProToolsHost() {
	const dataDir = join(
		process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : join(homedir(), ".dsh"),
		"pro-tools",
	);
	const stateFile = join(dataDir, "state.json");
	const pluginFile = join(dataDir, "desktop", "plugin.cjs");
	const requireDesktop = createRequire(import.meta.url);

	/** Read the published switch state; any problem means "nothing enabled". */
	const readState = () => {
		try {
			const parsed = JSON.parse(readFileSync(stateFile, "utf8"));
			const features = parsed && parsed.features && typeof parsed.features === "object" ? parsed.features : {};
			return { features };
		} catch {
			return { features: {} };
		}
	};

	let pluginCache;
	/**
	 * Load the desktop plugin, reloading it when the published copy changes so an
	 * update of dsh-pro-tools needs no application restart.
	 */
	const loadPlugin = (mtime) => {
		if (pluginCache !== undefined && pluginCache.mtime === mtime) return pluginCache.plugin;
		let plugin;
		try {
			try {
				delete requireDesktop.cache?.[pluginFile];
			} catch {
				/* a locked require cache only means "stale until restart" */
			}
			plugin = requireDesktop(pluginFile);
		} catch (error) {
			console.warn("dsh-pro-tools: desktop plugin unavailable", error);
			plugin = undefined;
		}
		pluginCache = { mtime, plugin };
		return plugin;
	};

	const pluginMtime = () => {
		try {
			return lstatSync(pluginFile).mtimeMs;
		} catch {
			return 0;
		}
	};

	/** The Electron surface handed to the plugin; additive, never breaking. */
	const electronApi = () => ({
		app,
		Menu,
		shell,
		dialog,
		Notification,
		BrowserWindow,
		dataDir,
		stateFile,
		tray: typeof tray !== "undefined" ? tray : undefined,
		quitWithoutConfirmation: typeof quitWithoutConfirmation === "function" ? quitWithoutConfirmation : undefined,
		focusPrimaryWindow: typeof focusPrimaryWindow === "function" ? focusPrimaryWindow : () => {},
	});

	/** 'zh' | 'en' from the shell's own locale. */
	const localeId = () => {
		try {
			return String(currentDesktopLocale().id ?? "").toLowerCase().startsWith("zh") ? "zh" : "en";
		} catch {
			return "zh";
		}
	};

	/** Ask the plugin for rows and normalize them; a broken plugin yields none. */
	const readRows = () => {
		const state = readState();
		const plugin = loadPlugin(pluginMtime());
		if (plugin === undefined || typeof plugin.trayItems !== "function") return [];
		let raw;
		try {
			raw = plugin.trayItems({ state, locale: localeId(), ...electronApi() });
		} catch (error) {
			console.warn("dsh-pro-tools: trayItems() failed", error);
			return [];
		}
		if (!Array.isArray(raw)) return [];
		const rows = [];
		for (const row of raw) {
			if (!row || typeof row !== "object") continue;
			const feature = typeof row.feature === "string" ? row.feature : undefined;
			if (feature !== undefined && state.features[feature] !== true) continue;
			const labels = row.label && typeof row.label === "object" ? row.label : {};
			rows.push({
				id: typeof row.id === "string" && row.id ? row.id : `row-${rows.length}`,
				order: Number.isFinite(row.order) ? row.order : 0,
				labels: { zh: typeof labels.zh === "string" ? labels.zh : "", en: typeof labels.en === "string" ? labels.en : "" },
				label: typeof row.label === "string" ? row.label : "",
				run: typeof row.run === "function" ? row.run : undefined,
				action: row.action && typeof row.action === "object" ? row.action : undefined,
			});
		}
		rows.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
		return rows.slice(0, 16);
	};

	/** Localized label for a normalized row. */
	const labelOf = (row) => {
		const picked = localeId() === "zh" ? row.labels.zh : row.labels.en;
		return picked || row.label || row.labels.en || row.labels.zh || "dsh-pro-tools";
	};

	/** Plugin first, host-handled verbs second; failures never escape. */
	const runRow = (row) => {
		const api = { ...electronApi(), locale: localeId() };
		try {
			if (row.run !== undefined && row.run(api) === false) {
				/* the plugin declined; fall through to the declarative action */
			} else if (row.run !== undefined) {
				return;
			}
		} catch (error) {
			console.warn("dsh-pro-tools: tray row failed", error);
		}
		const action = row.action;
		if (action === undefined) return;
		try {
			if (action.type === "builtin") {
				if (action.name === "restart") {
					app.relaunch();
					if (typeof quitWithoutConfirmation === "function") quitWithoutConfirmation();
					else app.quit();
					return;
				}
				if (action.name === "quit") {
					app.quit();
					return;
				}
				if (action.name === "open") {
					focusPrimaryWindow();
				}
				return;
			}
			if (action.type === "openPath" && typeof action.path === "string" && action.path) {
				shell.openPath(action.path);
				return;
			}
			if (action.type === "openUrl" && typeof action.url === "string" && action.url) {
				shell.openExternal(action.url);
			}
		} catch (error) {
			console.warn("dsh-pro-tools: tray action failed", error);
		}
	};

	/** Fallback menu, used only when the shell's own template cannot be observed. */
	const buildMenu = () => {
		const { messages } = currentDesktopLocale();
		const rows = readRows().map((row) => ({ label: labelOf(row), click: () => { runRow(row); } }));
		return Menu.buildFromTemplate([
			{ label: messages.openApplication, click: () => { focusPrimaryWindow(); } },
			...rows,
			{ type: "separator" },
			{ label: messages.quitApplication, click: () => { app.quit(); } },
		]);
	};

	/**
	 * Attach to the live DesktopTray: capture the shell's own menu template while
	 * it relabels, splice the plugin's rows in before the final separator, and
	 * poll the switch state plus the plugin file so a settings toggle updates the
	 * tray without a restart.
	 */
	const attach = (trayInstance) => {
		const base = typeof trayInstance.relabel === "function" ? trayInstance.relabel.bind(trayInstance) : undefined;
		const compose = () => {
			if (!trayInstance || !trayInstance.tray || typeof trayInstance.tray.setContextMenu !== "function") return;
			const rows = readRows().map((row) => ({ label: labelOf(row), click: () => { runRow(row); } }));
			let template;
			const original = Menu.buildFromTemplate;
			Menu.buildFromTemplate = function capture(items) {
				if (Array.isArray(items)) template = items;
				return original.apply(this, [items]);
			};
			try {
				if (base) base();
			} catch (error) {
				console.warn("dsh-pro-tools: shell relabel failed", error);
			} finally {
				Menu.buildFromTemplate = original;
			}
			try {
				if (Array.isArray(template)) {
					const merged = template.slice();
					if (rows.length > 0) {
						const separator = merged.findIndex((item) => item && item.type === "separator");
						merged.splice(separator < 0 ? merged.length : separator, 0, ...rows);
					}
					trayInstance.tray.setContextMenu(Menu.buildFromTemplate(merged));
				} else if (rows.length > 0) {
					trayInstance.tray.setContextMenu(buildMenu());
				}
			} catch (error) {
				console.warn("dsh-pro-tools: could not set the tray menu", error);
			}
		};
		if (base) trayInstance.relabel = () => { compose(); };
		compose();
		let signature = `${JSON.stringify(readState().features)}|${String(pluginMtime())}`;
		const timer = setInterval(() => {
			let next;
			try {
				next = `${JSON.stringify(readState().features)}|${String(pluginMtime())}`;
			} catch {
				return;
			}
			if (next === signature) return;
			signature = next;
			compose();
		}, 1500);
		if (timer && typeof timer.unref === "function") timer.unref();
		return compose;
	};

	return { dataDir, stateFile, pluginFile, readState, readRows, labelOf, runRow, buildMenu, attach };
})();
try {
	if (typeof tray !== "undefined" && tray) dshProToolsDesktop.attach(tray);
} catch (error) {
	console.warn("dsh-pro-tools: desktop host unavailable", error);
}
// <<< dsh-pro-tools desktop host v2
