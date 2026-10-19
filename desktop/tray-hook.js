// >>> dsh-pro-tools tray hook v1
// Canonical source lives in the dsh-pro-tools repository at desktop/tray-hook.js.
// `node desktop/apply-desktop-hook.mjs` injects this region into the desktop
// shell's lib/main.js and removes it again on --uninstall. Keep the region
// self-contained: it may only use identifiers that main.js already imports
// (join, readFileSync, homedir, Menu, app, shell, setInterval) plus module-scope
// helpers of the desktop shell (currentDesktopLocale, focusPrimaryWindow,
// quitWithoutConfirmation, tray). Absent helpers degrade instead of throwing.
var dshProToolsTray = (function createDshProToolsTray() {
	const stateFile = join(
		process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : join(homedir(), ".dsh"),
		"pro-tools",
		"tray.json",
	);
	/** Read and normalize the shared state file; any error means "no contribution". */
	const readItems = () => {
		let parsed;
		try {
			parsed = JSON.parse(readFileSync(stateFile, "utf8"));
		} catch {
			return [];
		}
		const rows = parsed && Array.isArray(parsed.items) ? parsed.items : [];
		const items = [];
		for (const row of rows) {
			if (!row || typeof row !== "object") continue;
			const action = row.action;
			if (!action || typeof action !== "object" || typeof action.type !== "string") continue;
			const labels = row.labels && typeof row.labels === "object" ? row.labels : {};
			items.push({
				id: typeof row.id === "string" && row.id ? row.id : `item-${items.length}`,
				order: Number.isFinite(row.order) ? row.order : 0,
				labels: {
					zh: typeof labels.zh === "string" ? labels.zh : "",
					en: typeof labels.en === "string" ? labels.en : "",
				},
				label: typeof row.label === "string" ? row.label : "",
				action,
			});
		}
		items.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
		return items.slice(0, 12);
	};
	/** Localized label, following the shell's own locale. */
	const labelOf = (item) => {
		let chinese = true;
		try {
			const locale = currentDesktopLocale();
			chinese = String(locale && locale.id ? locale.id : "").toLowerCase().startsWith("zh");
		} catch {
			chinese = true;
		}
		const picked = chinese ? item.labels.zh : item.labels.en;
		if (picked) return picked;
		return item.label || item.labels.en || item.labels.zh || "dsh-pro-tools";
	};
	/** Run one contributed action; unknown verbs are ignored, failures are logged. */
	const runAction = (item) => {
		const action = item.action;
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
	/** Fallback menu used when the shell's own template cannot be observed. */
	const buildMenu = () => {
		const { messages } = currentDesktopLocale();
		const rows = readItems().map((item) => ({ label: labelOf(item), click: () => { runAction(item); } }));
		return Menu.buildFromTemplate([
			{ label: messages.openApplication, click: () => { focusPrimaryWindow(); } },
			...rows,
			{ type: "separator" },
			{ label: messages.quitApplication, click: () => { app.quit(); } },
		]);
	};
	/**
	 * Attach to a live DesktopTray: capture the shell's own menu template while it
	 * relabels, splice the contributed rows in before the final separator, and keep
	 * polling the state file so a settings toggle updates the tray without a restart.
	 */
	const attach = (trayInstance) => {
		const base = typeof trayInstance.relabel === "function" ? trayInstance.relabel.bind(trayInstance) : undefined;
		const compose = () => {
			if (!trayInstance || !trayInstance.tray || typeof trayInstance.tray.setContextMenu !== "function") return;
			const rows = readItems().map((item) => ({ label: labelOf(item), click: () => { runAction(item); } }));
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
		let cache = JSON.stringify(readItems());
		const timer = setInterval(() => {
			let next;
			try {
				next = JSON.stringify(readItems());
			} catch {
				return;
			}
			if (next === cache) return;
			cache = next;
			compose();
		}, 1500);
		if (timer && typeof timer.unref === "function") timer.unref();
		return compose;
	};
	return { stateFile, readItems, labelOf, runAction, buildMenu, attach };
})();
try {
	if (typeof tray !== "undefined" && tray) dshProToolsTray.attach(tray);
} catch (error) {
	console.warn("dsh-pro-tools: tray hook unavailable", error);
}
// <<< dsh-pro-tools tray hook v1
