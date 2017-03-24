import { Subscription } from 'rxjs'
import { Component, NgZone, Output, EventEmitter, ElementRef } from '@angular/core'

import { ConfigService } from 'services/config'
import { PluginsService } from 'services/plugins'

import { BaseTabComponent } from 'components/baseTab'
import { TerminalTab } from '../tab'

import { hterm, preferenceManager } from '../hterm'


@Component({
  selector: 'terminalTab',
  template: '',
  styles: [require('./terminalTab.scss')],
})
export class TerminalTabComponent extends BaseTabComponent<TerminalTab> {
    title: string
    @Output() titleChange = new EventEmitter()
    terminal: any
    configSubscription: Subscription
    focusedSubscription: Subscription
    startupTime: number

    constructor(
        private zone: NgZone,
        private elementRef: ElementRef,
        public config: ConfigService,
        private plugins: PluginsService,
    ) {
        super()
        this.startupTime = performance.now()
        this.configSubscription = config.change.subscribe(() => {
            this.configure()
        })
    }

    initTab () {
        this.focusedSubscription = this.model.focused.subscribe(() => {
            this.terminal.scrollPort_.focus()
        })

        this.terminal = new hterm.hterm.Terminal()
        //this.pluginDispatcher.emit('preTerminalInit', { terminal: this.terminal })
        this.terminal.setWindowTitle = (title) => {
            this.zone.run(() => {
                this.title = title
                this.titleChange.emit(title)
            })
        }
        this.terminal.onTerminalReady = () => {
            this.terminal.installKeyboard()
            let io = this.terminal.io.push()
            const dataSubscription = this.model.session.dataAvailable.subscribe((data) => {
                if (performance.now() - this.startupTime > 500)  {
                    this.zone.run(() => {
                        this.model.displayActivity()
                    })
                }
                io.writeUTF8(data)
            })
            const closedSubscription = this.model.session.closed.subscribe(() => {
                dataSubscription.unsubscribe()
                closedSubscription.unsubscribe()
            })

            io.onVTKeystroke = io.sendString = (str) => {
                this.model.session.write(str)
            }
            io.onTerminalResize = (columns, rows) => {
                console.log(`Resizing to ${columns}x${rows}`)
                this.model.session.resize(columns, rows)
            }

            this.model.session.releaseInitialDataBuffer()
        }
        this.terminal.decorate(this.elementRef.nativeElement)
        this.configure()
        //this.pluginDispatcher.emit('postTerminalInit', { terminal: this.terminal })
    }

    configure () {
        let config = this.config.full()
        preferenceManager.set('font-family', config.appearance.font)
        preferenceManager.set('font-size', config.appearance.fontSize)
        preferenceManager.set('audible-bell-sound', '')
        preferenceManager.set('desktop-notification-bell', config.terminal.bell == 'notification')
        preferenceManager.set('enable-clipboard-notice', false)
        preferenceManager.set('receive-encoding', 'raw')
        preferenceManager.set('send-encoding', 'raw')
    }

    ngOnDestroy () {
        this.focusedSubscription.unsubscribe()
        this.configSubscription.unsubscribe()
    }
}
