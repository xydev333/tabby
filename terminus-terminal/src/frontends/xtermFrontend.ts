import { Frontend } from './frontend'
import { Terminal, ITheme } from 'xterm'
import { FitAddon } from './xtermAddonFit'
import { enableLigatures } from 'xterm-addon-ligatures'
import './xterm.css'
import deepEqual = require('deep-equal')

/** @hidden */
export class XTermFrontend extends Frontend {
    enableResizing = true
    xterm: Terminal
    xtermCore: any
    private configuredFontSize = 0
    private zoom = 0
    private resizeHandler: () => void
    private configuredTheme: ITheme = {}
    private copyOnSelect = false
    private fitAddon = new FitAddon()
    private opened = false

    constructor () {
        super()
        this.xterm = new Terminal({
            allowTransparency: true,
        })
        this.xtermCore = (this.xterm as any)._core

        this.xterm.onData(data => {
            this.input.next(data)
        })
        this.xterm.onResize(({ cols, rows }) => {
            this.resize.next({ rows, columns: cols })
        })
        this.xterm.onTitleChange(title => {
            this.title.next(title)
        })
        this.xterm.onSelectionChange(() => {
            if (this.copyOnSelect) {
                this.copySelection()
            }
        })
        this.xterm.loadAddon(this.fitAddon)

        const keyboardEventHandler = (name: string, event: KeyboardEvent) => {
            this.hotkeysService.pushKeystroke(name, event)
            let ret = true
            if (this.hotkeysService.getCurrentPartiallyMatchedHotkeys().length !== 0) {
                event.stopPropagation()
                event.preventDefault()
                ret = false
            }
            this.hotkeysService.processKeystrokes()
            this.hotkeysService.emitKeyEvent(event)

            return ret
        }

        this.xterm.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            if ((event.getModifierState('Control') || event.getModifierState('Meta')) && event.key.toLowerCase() === 'v') {
                event.preventDefault()
                return false
            }
            if (event.getModifierState('Meta') && event.key.startsWith('Arrow')) {
                return false
            }

            return keyboardEventHandler('keydown', event)
        })

        this.xtermCore._scrollToBottom = this.xtermCore.scrollToBottom.bind(this.xtermCore)
        this.xtermCore.scrollToBottom = () => null

        this.resizeHandler = () => {
            try {
                this.fitAddon.fit()
            } catch {
                // tends to throw when element wasn't shown yet
            }
        }

        this.xtermCore._keyUp = (e: KeyboardEvent) => {
            this.xtermCore.updateCursorStyle(e)
            keyboardEventHandler('keyup', e)
        }
    }

    attach (host: HTMLElement): void {
        this.xterm.open(host)
        this.opened = true
        ;(this.xterm as any).loadWebgl(false)
        if (this.configService.store.terminal.ligatures) {
            enableLigatures(this.xterm)
        }

        this.ready.next(null)
        this.ready.complete()

        window.addEventListener('resize', this.resizeHandler)

        this.resizeHandler()

        host.addEventListener('dragOver', (event: any) => this.dragOver.next(event))
        host.addEventListener('drop', event => this.drop.next(event))

        host.addEventListener('mousedown', event => this.mouseEvent.next(event as MouseEvent))
        host.addEventListener('mouseup', event => this.mouseEvent.next(event as MouseEvent))
        host.addEventListener('mousewheel', event => this.mouseEvent.next(event as MouseEvent))

        let ro = new window['ResizeObserver'](() => this.resizeHandler())
        ro.observe(host)
    }

    detach (host: HTMLElement): void {
        window.removeEventListener('resize', this.resizeHandler)
    }

    getSelection (): string {
        return this.xterm.getSelection()
    }

    copySelection (): void {
        (navigator as any).clipboard.writeText(this.getSelection())
    }

    clearSelection (): void {
        this.xterm.clearSelection()
    }

    focus (): void {
        setTimeout(() => this.xterm.focus())
    }

    write (data: string): void {
        this.xterm.write(data)
    }

    clear (): void {
        this.xterm.clear()
    }

    visualBell (): void {
        this.xtermCore.bell()
    }

    scrollToBottom (): void {
        this.xtermCore._scrollToBottom()
    }

    configure (): void {
        let config = this.configService.store

        setImmediate(() => {
            if (this.xterm.cols && this.xterm.rows && this.xtermCore.charMeasure) {
                if (this.xtermCore.charMeasure) {
                    this.xtermCore.charMeasure.measure(this.xtermCore.options)
                }
                if (this.xtermCore.renderer) {
                    this.xtermCore.renderer._updateDimensions()
                }
                this.resizeHandler()
            }
        })

        this.xterm.setOption('fontFamily', `"${config.terminal.font}", "monospace-fallback", monospace`)
        this.xterm.setOption('bellStyle', config.terminal.bell)
        this.xterm.setOption('cursorStyle', {
            beam: 'bar'
        }[config.terminal.cursor] || config.terminal.cursor)
        this.xterm.setOption('cursorBlink', config.terminal.cursorBlink)
        this.xterm.setOption('macOptionIsMeta', config.terminal.altIsMeta)
        this.xterm.setOption('scrollback', 100000)
        this.configuredFontSize = config.terminal.fontSize
        this.setFontSize()

        this.copyOnSelect = config.terminal.copyOnSelect

        let theme: ITheme = {
            foreground: config.terminal.colorScheme.foreground,
            background: (config.terminal.background === 'colorScheme') ? config.terminal.colorScheme.background : (config.appearance.vibrancy ? 'transparent' : this.themesService.findCurrentTheme().terminalBackground),
            cursor: config.terminal.colorScheme.cursor,
        }

        const colorNames = [
            'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
            'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
        ]

        for (let i = 0; i < colorNames.length; i++) {
            theme[colorNames[i]] = config.terminal.colorScheme.colors[i]
        }

        if (this.xtermCore._colorManager && !deepEqual(this.configuredTheme, theme)) {
            this.xterm.setOption('theme', theme)
            this.configuredTheme = theme
        }

        if (this.opened && config.terminal.ligatures) {
            enableLigatures(this.xterm)
        }
    }

    setZoom (zoom: number): void {
        this.zoom = zoom
        this.setFontSize()
    }

    private setFontSize () {
        this.xterm.setOption('fontSize', this.configuredFontSize * Math.pow(1.1, this.zoom))
    }
}
