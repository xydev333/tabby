import { Injectable } from '@angular/core'
import { HotkeysService, ToolbarButtonProvider, IToolbarButton, AppService } from 'api'
import { SessionsService } from './services/sessions'
import { TerminalTabComponent } from './components/terminalTab'


@Injectable()
export class ButtonProvider extends ToolbarButtonProvider {
    constructor (
        private app: AppService,
        private sessions: SessionsService,
        hotkeys: HotkeysService,
    ) {
        super()
        hotkeys.matchedHotkey.subscribe(async (hotkey) => {
            if (hotkey == 'new-tab') {
                this.openNewTab()
            }
        })
    }

    async openNewTab (): Promise<void> {
        let cwd = null
        if (this.app.activeTab instanceof TerminalTabComponent) {
            cwd = await this.app.activeTab.session.getWorkingDirectory()
        }
        this.app.openNewTab(
            TerminalTabComponent,
            { session: await this.sessions.createNewSession({ command: 'zsh', cwd }) }
        )
    }

    provide (): IToolbarButton[] {
        return [{
            icon: 'plus',
            title: 'New terminal',
            click: async () => {
                this.openNewTab()
            }
        }]
    }
}
