import { app, ipcMain, Menu, Tray, shell, screen, globalShortcut, MenuItemConstructorOptions } from 'electron'
import * as promiseIpc from 'electron-promise-ipc'
import { loadConfig } from './config'
import { Window, WindowOptions } from './window'
import { pluginManager } from './pluginManager'

export class Application {
    private tray?: Tray
    private windows: Window[] = []

    constructor () {
        ipcMain.on('app:config-change', (_event, config) => {
            this.broadcast('host:config-change', config)
        })

        ipcMain.on('app:register-global-hotkey', (_event, specs) => {
            globalShortcut.unregisterAll()
            for (const spec of specs) {
                globalShortcut.register(spec, () => {
                    this.onGlobalHotkey()
                })
            }
        })

        ;(promiseIpc as any).on('plugin-manager:install', (path, name, version) => {
            return pluginManager.install(path, name, version)
        })

        ;(promiseIpc as any).on('plugin-manager:uninstall', (path, name) => {
            return pluginManager.uninstall(path, name)
        })

        const configData = loadConfig()
        if (process.platform === 'linux') {
            app.commandLine.appendSwitch('no-sandbox')
            if (((configData.appearance || {}).opacity || 1) !== 1) {
                app.commandLine.appendSwitch('enable-transparent-visuals')
                app.disableHardwareAcceleration()
            }
        }

        app.commandLine.appendSwitch('disable-http-cache')
        app.commandLine.appendSwitch('lang', 'EN')
        app.allowRendererProcessReuse = false

        for (const flag of configData.flags || [['force_discrete_gpu', '0']]) {
            app.commandLine.appendSwitch(flag[0], flag[1])
        }
    }

    init (): void {
        screen.on('display-metrics-changed', () => this.broadcast('host:display-metrics-changed'))
        screen.on('display-added', () => this.broadcast('host:displays-changed'))
        screen.on('display-removed', () => this.broadcast('host:displays-changed'))
    }

    async newWindow (options?: WindowOptions): Promise<Window> {
        const window = new Window(options)
        this.windows.push(window)
        window.visible$.subscribe(visible => {
            if (visible) {
                this.disableTray()
            } else {
                this.enableTray()
            }
        })
        window.closed$.subscribe(() => {
            this.windows = this.windows.filter(x => x !== window)
        })
        if (process.platform === 'darwin') {
            this.setupMenu()
        }
        await window.ready
        return window
    }

    onGlobalHotkey (): void {
        if (this.windows.some(x => x.isFocused() && x.isVisible())) {
            for (const window of this.windows) {
                window.hide()
            }
        } else {
            for (const window of this.windows) {
                window.present()
            }
        }
    }

    presentAllWindows (): void {
        for (const window of this.windows) {
            window.present()
        }
    }

    broadcast (event: string, ...args: any[]): void {
        for (const window of this.windows) {
            window.send(event, ...args)
        }
    }

    async send (event: string, ...args: any[]): Promise<void> {
        if (!this.hasWindows()) {
            await this.newWindow()
        }
        this.windows.filter(w => !w.isDestroyed())[0].send(event, ...args)
    }

    enableTray (): void {
        if (this.tray) {
            return
        }
        if (process.platform === 'darwin') {
            this.tray = new Tray(`${app.getAppPath()}/assets/tray-darwinTemplate.png`)
            this.tray.setPressedImage(`${app.getAppPath()}/assets/tray-darwinHighlightTemplate.png`)
        } else {
            this.tray = new Tray(`${app.getAppPath()}/assets/tray.png`)
        }

        this.tray.on('click', () => setTimeout(() => this.focus()))

        const contextMenu = Menu.buildFromTemplate([{
            label: 'Show',
            click: () => this.focus(),
        }])

        if (process.platform !== 'darwin') {
            this.tray.setContextMenu(contextMenu)
        }

        this.tray.setToolTip(`Terminus ${app.getVersion()}`)
    }

    disableTray (): void {
        this.tray?.destroy()
        this.tray = null
    }

    hasWindows (): boolean {
        return !!this.windows.length
    }

    focus (): void {
        for (const window of this.windows) {
            window.show()
        }
    }

    handleSecondInstance (argv: string[], cwd: string): void {
        this.presentAllWindows()
        this.windows[this.windows.length - 1].passCliArguments(argv, cwd, true)
    }

    private setupMenu () {
        const template: MenuItemConstructorOptions[] = [
            {
                label: 'Application',
                submenu: [
                    { role: 'about', label: 'About Terminus' },
                    { type: 'separator' },
                    {
                        label: 'Preferences',
                        accelerator: 'Cmd+,',
                        click: async () => {
                            if (!this.hasWindows()) {
                                await this.newWindow()
                            }
                            this.windows[0].send('host:preferences-menu')
                        },
                    },
                    { type: 'separator' },
                    { role: 'services', submenu: [] },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    {
                        label: 'Quit',
                        accelerator: 'Cmd+Q',
                        click () {
                            app.quit()
                        },
                    },
                ],
            },
            {
                label: 'Edit',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' },
                ],
            },
            {
                label: 'View',
                submenu: [
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' },
                ],
            },
            {
                role: 'window',
                submenu: [
                    { role: 'minimize' },
                    { role: 'zoom' },
                    { type: 'separator' },
                    { role: 'front' },
                ],
            },
            {
                role: 'help',
                submenu: [
                    {
                        label: 'Website',
                        click () {
                            shell.openExternal('https://eugeny.github.io/terminus')
                        },
                    },
                ],
            },
        ]

        Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }
}
