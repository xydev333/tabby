import { Component } from '@angular/core'
import { ConfigService, ElectronService } from 'terminus-core'
import { TerminalService } from '../services/terminal.service'

/** @hidden */
@Component({
    template: require('./terminalSettingsTab.component.pug'),
})
export class TerminalSettingsTabComponent {
    constructor (
        public config: ConfigService,
        private electron: ElectronService,
        private terminal: TerminalService,
    ) { }

    openWSLVolumeMixer (): void {
        this.electron.shell.openPath('sndvol.exe')
        this.terminal.openTab({
            name: '',
            sessionOptions: {
                command: 'wsl.exe',
                args: ['tput', 'bel'],
            },
        }, null, true)
    }
}
