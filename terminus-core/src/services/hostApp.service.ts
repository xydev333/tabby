import type { BrowserWindow, TouchBar, MenuItemConstructorOptions } from 'electron'
import * as path from 'path'
import * as fs from 'mz/fs'
import shellEscape from 'shell-escape'
import { Observable, Subject } from 'rxjs'
import { Injectable, NgZone, EventEmitter } from '@angular/core'
import { ElectronService } from './electron.service'
import { Logger, LogService } from './log.service'
import { isWindowsBuild, WIN_BUILD_FLUENT_BG_SUPPORTED } from '../utils'

/* eslint-disable block-scoped-var */

try {
    var wnr = require('windows-native-registry') // eslint-disable-line @typescript-eslint/no-var-requires, no-var
} catch (_) { }

export enum Platform {
    Linux = 'Linux',
    macOS = 'macOS',
    Windows = 'Windows',
}

export interface Bounds {
    x: number
    y: number
    width: number
    height: number
}

/**
 * Provides interaction with the main process
 */
@Injectable({ providedIn: 'root' })
export class HostAppService {
    platform: Platform

    /**
     * Fired once the window is visible
     */
    shown = new EventEmitter<any>()
    isFullScreen = false
    isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE

    private preferencesMenu = new Subject<void>()
    private secondInstance = new Subject<void>()
    private cliOpenDirectory = new Subject<string>()
    private cliRunCommand = new Subject<string[]>()
    private cliPaste = new Subject<string>()
    private cliOpenProfile = new Subject<string>()
    private configChangeBroadcast = new Subject<void>()
    private windowCloseRequest = new Subject<void>()
    private windowMoved = new Subject<void>()
    private windowFocused = new Subject<void>()
    private displayMetricsChanged = new Subject<void>()
    private displaysChanged = new Subject<void>()
    private logger: Logger
    private windowId: number

    /**
     * Fired when Preferences is selected in the macOS menu
     */
    get preferencesMenu$ (): Observable<void> { return this.preferencesMenu }

    /**
     * Fired when a second instance of Terminus is launched
     */
    get secondInstance$ (): Observable<void> { return this.secondInstance }

    /**
     * Fired for the `terminus open` CLI command
     */
    get cliOpenDirectory$ (): Observable<string> { return this.cliOpenDirectory }

    /**
     * Fired for the `terminus run` CLI command
     */
    get cliRunCommand$ (): Observable<string[]> { return this.cliRunCommand }

    /**
     * Fired for the `terminus paste` CLI command
     */
    get cliPaste$ (): Observable<string> { return this.cliPaste }

    /**
     * Fired for the `terminus profile` CLI command
     */
    get cliOpenProfile$ (): Observable<string> { return this.cliOpenProfile }

    /**
     * Fired when another window modified the config file
     */
    get configChangeBroadcast$ (): Observable<void> { return this.configChangeBroadcast }

    /**
     * Fired when the window close button is pressed
     */
    get windowCloseRequest$ (): Observable<void> { return this.windowCloseRequest }

    get windowMoved$ (): Observable<void> { return this.windowMoved }

    get windowFocused$ (): Observable<void> { return this.windowFocused }

    get displayMetricsChanged$ (): Observable<void> { return this.displayMetricsChanged }

    get displaysChanged$ (): Observable<void> { return this.displaysChanged }

    private constructor (
        private zone: NgZone,
        private electron: ElectronService,
        log: LogService,
    ) {
        this.logger = log.create('hostApp')
        this.platform = {
            win32: Platform.Windows,
            darwin: Platform.macOS,
            linux: Platform.Linux,
        }[process.platform]

        this.windowId = parseInt(location.search.substring(1))
        this.logger.info('Window ID:', this.windowId)

        electron.ipcRenderer.on('host:preferences-menu', () => this.zone.run(() => this.preferencesMenu.next()))

        electron.ipcRenderer.on('uncaughtException', (_$event, err) => {
            this.logger.error('Unhandled exception:', err)
        })

        electron.ipcRenderer.on('host:window-enter-full-screen', () => this.zone.run(() => {
            this.isFullScreen = true
        }))

        electron.ipcRenderer.on('host:window-leave-full-screen', () => this.zone.run(() => {
            this.isFullScreen = false
        }))

        electron.ipcRenderer.on('host:window-shown', () => {
            this.zone.run(() => this.shown.emit())
        })

        electron.ipcRenderer.on('host:window-close-request', () => {
            this.zone.run(() => this.windowCloseRequest.next())
        })

        electron.ipcRenderer.on('host:window-moved', () => {
            this.zone.run(() => this.windowMoved.next())
        })

        electron.ipcRenderer.on('host:window-focused', () => {
            this.zone.run(() => this.windowFocused.next())
        })

        electron.ipcRenderer.on('host:display-metrics-changed', () => {
            this.zone.run(() => this.displayMetricsChanged.next())
        })

        electron.ipcRenderer.on('host:displays-changed', () => {
            this.zone.run(() => this.displaysChanged.next())
        })

        electron.ipcRenderer.on('cli', (_$event, argv: any, cwd: string, secondInstance: boolean) => this.zone.run(async () => {
            this.logger.info('Second instance', argv)
            const op = argv._[0]
            const opAsPath = op ? path.resolve(cwd, op) : null
            if (op === 'open') {
                this.cliOpenDirectory.next(path.resolve(cwd, argv.directory))
            } else if (op === 'run') {
                this.cliRunCommand.next(argv.command)
            } else if (op === 'paste') {
                let text = argv.text
                if (argv.escape) {
                    text = shellEscape([text])
                }
                this.cliPaste.next(text)
            } else if (op === 'profile') {
                this.cliOpenProfile.next(argv.profileName)
            } else if (secondInstance && op === undefined) {
                this.newWindow()
            } else if (opAsPath && (await fs.lstat(opAsPath)).isDirectory()) {
                this.cliOpenDirectory.next(opAsPath)
            }

            if (secondInstance) {
                this.secondInstance.next()
            }
        }))

        electron.ipcRenderer.on('host:config-change', () => this.zone.run(() => {
            this.configChangeBroadcast.next()
        }))

        if (isWindowsBuild(WIN_BUILD_FLUENT_BG_SUPPORTED)) {
            electron.ipcRenderer.send('window-set-disable-vibrancy-while-dragging', true)
        }
    }

    /**
     * Returns the current remote [[BrowserWindow]]
     */
    getWindow (): BrowserWindow {
        return this.electron.BrowserWindow.fromId(this.windowId)!
    }

    newWindow (): void {
        this.electron.ipcRenderer.send('app:new-window')
    }

    toggleFullscreen (): void {
        const window = this.getWindow()
        window.setFullScreen(!this.isFullScreen)
    }

    openDevTools (): void {
        this.getWindow().webContents.openDevTools({ mode: 'undocked' })
    }

    focusWindow (): void {
        this.electron.ipcRenderer.send('window-focus')
    }

    minimize (): void {
        this.electron.ipcRenderer.send('window-minimize')
    }

    maximize (): void {
        this.electron.ipcRenderer.send('window-maximize')
    }

    unmaximize (): void {
        this.electron.ipcRenderer.send('window-unmaximize')
    }

    toggleMaximize (): void {
        this.electron.ipcRenderer.send('window-toggle-maximize')
    }

    setBounds (bounds: Bounds): void {
        this.electron.ipcRenderer.send('window-set-bounds', bounds)
    }

    setAlwaysOnTop (flag: boolean): void {
        this.electron.ipcRenderer.send('window-set-always-on-top', flag)
    }

    /**
     * Sets window vibrancy mode (Windows, macOS)
     *
     * @param type `null`, or `fluent` when supported (Windowd only)
     */
    setVibrancy (enable: boolean, type: string|null): void {
        if (this.platform === Platform.Windows && !isWindowsBuild(WIN_BUILD_FLUENT_BG_SUPPORTED)) {
            type = null
        }
        document.body.classList.toggle('vibrant', enable)
        this.electron.ipcRenderer.send('window-set-vibrancy', enable, type)
    }

    setTitle (title?: string): void {
        this.electron.ipcRenderer.send('window-set-title', title ?? 'Terminus')
    }

    setTouchBar (touchBar: TouchBar): void {
        this.getWindow().setTouchBar(touchBar)
    }

    popupContextMenu (menuDefinition: MenuItemConstructorOptions[]): void {
        this.electron.Menu.buildFromTemplate(menuDefinition).popup({})
    }

    /**
     * Notifies other windows of config file changes
     */
    broadcastConfigChange (configStore: Record<string, any>): void {
        this.electron.ipcRenderer.send('app:config-change', configStore)
    }

    emitReady (): void {
        this.electron.ipcRenderer.send('app:ready')
    }

    bringToFront (): void {
        this.electron.ipcRenderer.send('window-bring-to-front')
    }

    closeWindow (): void {
        this.electron.ipcRenderer.send('window-close')
    }

    registerGlobalHotkey (specs: string[]): void {
        this.electron.ipcRenderer.send('app:register-global-hotkey', specs)
    }

    useBuiltinGraphics (): void {
        const keyPath = 'SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences'
        const valueName = this.electron.app.getPath('exe')
        if (this.platform === Platform.Windows) {
            if (!wnr.getRegistryValue(wnr.HK.CU, keyPath, valueName)) {
                wnr.setRegistryValue(wnr.HK.CU, keyPath, valueName, wnr.REG.SZ, 'GpuPreference=1;')
            }
        }
    }

    setTrafficLightInset (x: number, y: number): void {
        this.getWindow().setTrafficLightPosition({ x, y })
    }

    relaunch (): void {
        if (this.isPortable) {
            this.electron.app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE })
        } else {
            this.electron.app.relaunch()
        }
        this.electron.app.exit()
    }

    quit (): void {
        this.logger.info('Quitting')
        this.electron.app.quit()
    }
}
