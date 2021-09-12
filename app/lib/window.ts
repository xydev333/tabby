import { Subject, Observable } from 'rxjs'
import { debounceTime } from 'rxjs/operators'
import { BrowserWindow, app, ipcMain, Rectangle, screen } from 'electron'
import ElectronConfig = require('electron-config')
import * as os from 'os'
import * as path from 'path'

import { loadConfig } from './config'

let SetWindowCompositionAttribute: any
let AccentState: any
let DwmEnableBlurBehindWindow: any
if (process.platform === 'win32') {
    SetWindowCompositionAttribute = require('windows-swca').SetWindowCompositionAttribute
    AccentState = require('windows-swca').ACCENT_STATE
    DwmEnableBlurBehindWindow = require('windows-blurbehind').DwmEnableBlurBehindWindow
}

export interface WindowOptions {
    hidden?: boolean
}

export class Window {
    ready: Promise<void>
    private visible = new Subject<boolean>()
    private window: BrowserWindow
    private windowConfig: ElectronConfig
    private windowBounds: Rectangle
    private closing = false
    private lastVibrancy: {enabled: boolean, type?: string} | null = null
    private disableVibrancyWhileDragging = false

    get visible$ (): Observable<boolean> { return this.visible }

    constructor (options?: WindowOptions) {
        let configData = loadConfig()

        options = options || {}

        this.windowConfig = new ElectronConfig({ name: 'window' })
        this.windowBounds = this.windowConfig.get('windowBoundaries')

        let maximized = this.windowConfig.get('maximized')
        let bwOptions: Electron.BrowserWindowConstructorOptions = {
            width: 800,
            height: 600,
            title: 'Terminus',
            minWidth: 400,
            minHeight: 300,
            webPreferences: {
                nodeIntegration: true,
                preload: path.join(__dirname, 'sentry.js'),
                backgroundThrottling: false,
            },
            frame: false,
            show: false,
            backgroundColor: '#00000000',
        }

        if (this.windowBounds) {
            Object.assign(bwOptions, this.windowBounds)
            const closestDisplay = screen.getDisplayNearestPoint( { x: this.windowBounds.x, y: this.windowBounds.y } )

            const [left1, top1, right1, bottom1] = [this.windowBounds.x, this.windowBounds.y, this.windowBounds.x + this.windowBounds.width, this.windowBounds.y + this.windowBounds.height]
            const [left2, top2, right2, bottom2] = [closestDisplay.bounds.x, closestDisplay.bounds.y, closestDisplay.bounds.x + closestDisplay.bounds.width, closestDisplay.bounds.y + closestDisplay.bounds.height]

            if ((left2 > right1 || right2 < left1 || top2 > bottom1 || bottom2 < top1) && !maximized) {
                bwOptions.x = closestDisplay.bounds.width / 2 - bwOptions.width / 2
                bwOptions.y = closestDisplay.bounds.height / 2 - bwOptions.height / 2
            }
        }

        if ((configData.appearance || {}).frame === 'native') {
            bwOptions.frame = true
        } else {
            if (process.platform === 'darwin') {
                bwOptions.titleBarStyle = 'hiddenInset'
            }
        }

        if (process.platform === 'linux') {
            bwOptions.backgroundColor = '#131d27'
        }

        this.window = new BrowserWindow(bwOptions)
        this.window.once('ready-to-show', () => {
            if (process.platform === 'darwin') {
                this.window.setVibrancy('window')
            } else if (process.platform === 'win32' && (configData.appearance || {}).vibrancy) {
                this.setVibrancy(true)
            }

            if (!options.hidden) {
                if (maximized) {
                    this.window.maximize()
                } else {
                    this.window.show()
                }
                this.window.focus()
            }
        })

        this.window.loadURL(`file://${app.getAppPath()}/dist/index.html?${this.window.id}`, { extraHeaders: 'pragma: no-cache\n' })

        if (process.platform !== 'darwin') {
            this.window.setMenu(null)
        }

        this.setupWindowManagement()

        this.ready = new Promise(resolve => {
            const listener = event => {
                if (event.sender === this.window.webContents) {
                    ipcMain.removeListener('app:ready', listener as any)
                    resolve()
                }
            }
            ipcMain.on('app:ready', listener)
        })
    }

    setVibrancy (enabled: boolean, type?: string): void {
        this.lastVibrancy = { enabled, type }
        if (process.platform === 'win32') {
            if (parseFloat(os.release()) >= 10) {
                let attribValue = AccentState.ACCENT_DISABLED
                if (enabled) {
                    if (type === 'fluent') {
                        attribValue = AccentState.ACCENT_ENABLE_ACRYLICBLURBEHIND
                    } else {
                        attribValue = AccentState.ACCENT_ENABLE_BLURBEHIND
                    }
                }
                SetWindowCompositionAttribute(this.window.getNativeWindowHandle(), attribValue, 0x00000000)
            } else {
                DwmEnableBlurBehindWindow(this.window, enabled)
            }
        } else {
            this.window.setVibrancy(enabled ? 'dark' : null as any) // electron issue 20269
        }
    }

    show (): void {
        this.window.show()
    }

    focus (): void {
        this.window.focus()
    }

    send (event: string, ...args): void {
        if (!this.window) {
            return
        }
        this.window.webContents.send(event, ...args)
    }

    isDestroyed (): void {
        return !this.window || this.window.isDestroyed()
    }

    private setupWindowManagement () {
        this.window.on('show', () => {
            this.visible.next(true)
            this.send('host:window-shown')
        })

        this.window.on('hide', () => {
            this.visible.next(false)
        })

        let moveSubscription = new Observable<void>(observer => {
            this.window.on('move', () => observer.next())
        }).pipe(debounceTime(250)).subscribe(() => {
            this.send('host:window-moved')
        })

        this.window.on('closed', () => {
            moveSubscription.unsubscribe()
        })

        this.window.on('enter-full-screen', () => this.send('host:window-enter-full-screen'))
        this.window.on('leave-full-screen', () => this.send('host:window-leave-full-screen'))

        this.window.on('close', event => {
            if (!this.closing) {
                event.preventDefault()
                this.send('host:window-close-request')
                return
            }
            this.windowConfig.set('windowBoundaries', this.windowBounds)
            this.windowConfig.set('maximized', this.window.isMaximized())
        })

        this.window.on('closed', () => {
            this.destroy()
        })

        this.window.on('resize', () => {
            if (!this.window.isMaximized()) {
                this.windowBounds = this.window.getBounds()
            }
        })

        this.window.on('move', () => {
            if (!this.window.isMaximized()) {
                this.windowBounds = this.window.getBounds()
            }
        })

        this.window.on('focus', () => {
            this.send('host:window-focused')
        })

        ipcMain.on('window-focus', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.window.focus()
        })

        ipcMain.on('window-maximize', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.window.maximize()
        })

        ipcMain.on('window-unmaximize', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.window.unmaximize()
        })

        ipcMain.on('window-toggle-maximize', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            if (this.window.isMaximized()) {
                this.window.unmaximize()
            } else {
                this.window.maximize()
            }
        })

        ipcMain.on('window-minimize', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.window.minimize()
        })

        ipcMain.on('window-set-bounds', (event, bounds) => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.window.setBounds(bounds)
        })

        ipcMain.on('window-set-always-on-top', (event, flag) => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.window.setAlwaysOnTop(flag)
        })

        ipcMain.on('window-set-vibrancy', (event, enabled, type) => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.setVibrancy(enabled, type)
        })

        ipcMain.on('window-set-title', (event, title) => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.window.setTitle(title)
        })

        ipcMain.on('window-bring-to-front', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            if (this.window.isMinimized()) {
                this.window.restore()
            }
            this.window.show()
            this.window.moveTop()
        })

        ipcMain.on('window-close', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return
            }
            this.closing = true
            this.window.close()
        })

        this.window.webContents.on('new-window', event => event.preventDefault())

        ipcMain.on('window-set-disable-vibrancy-while-dragging', (_event, value) => {
            this.disableVibrancyWhileDragging = value
        })

        this.window.on('will-move', () => {
            if (!this.lastVibrancy?.enabled || !this.disableVibrancyWhileDragging) {
                return
            }
            let timeout: number|null = null
            const oldVibrancy = this.lastVibrancy
            this.setVibrancy(false)
            const onMove = () => {
                if (timeout) {
                    clearTimeout(timeout)
                }
                timeout = setTimeout(() => {
                    this.window.off('move', onMove)
                    this.setVibrancy(oldVibrancy.enabled, oldVibrancy.type)
                }, 500)
            }
            this.window.on('move', onMove)
        })
    }

    private destroy () {
        this.window = null
        this.visible.complete()
    }
}
