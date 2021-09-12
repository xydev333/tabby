import * as fs from 'mz/fs'
import slugify from 'slugify'
import { Observable, AsyncSubject } from 'rxjs'
import { Injectable, Inject } from '@angular/core'
import { AppService, Logger, LogService, ConfigService, SplitTabComponent } from 'terminus-core'
import { ShellProvider } from '../api/shellProvider'
import { Shell, SessionOptions, Profile } from '../api/interfaces'
import { TerminalTabComponent } from '../components/terminalTab.component'
import { UACService } from './uac.service'

@Injectable({ providedIn: 'root' })
export class TerminalService {
    private shells = new AsyncSubject<Shell[]>()
    private logger: Logger

    /**
     * A fresh list of all available shells
     */
    get shells$ (): Observable<Shell[]> { return this.shells }

    /** @hidden */
    private constructor (
        private app: AppService,
        private config: ConfigService,
        private uac: UACService,
        @Inject(ShellProvider) private shellProviders: ShellProvider[],
        log: LogService,
    ) {
        this.logger = log.create('terminal')
        this.reloadShells()

        config.changed$.subscribe(() => {
            this.reloadShells()
        })
    }

    async getProfiles ({ includeHidden, skipDefault }: { includeHidden?: boolean, skipDefault?: boolean } = {}): Promise<Profile[]> {
        const shells = await this.shells$.toPromise()
        return [
            ...this.config.store.terminal.profiles,
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            ...skipDefault ? [] : shells.filter(x => includeHidden || !x.hidden).map(shell => ({
                name: shell.name,
                shell: shell.id,
                icon: shell.icon,
                sessionOptions: this.optionsFromShell(shell),
                isBuiltin: true,
            })),
        ]
    }

    getProfileID (profile: Profile): string {
        return slugify(profile.name, { remove: /[:.]/g }).toLowerCase()
    }

    async getProfileByID (id: string): Promise<Profile|null> {
        const profiles = await this.getProfiles({ includeHidden: true })
        return profiles.find(x => this.getProfileID(x) === id) ?? null
    }

    /**
     * Launches a new terminal with a specific shell and CWD
     * @param pause Wait for a keypress when the shell exits
     */
    async openTab (profile?: Profile|null, cwd?: string|null, pause?: boolean): Promise<TerminalTabComponent> {
        if (!profile) {
            profile = await this.getProfileByID(this.config.store.terminal.profile)
            if (!profile) {
                profile = (await this.getProfiles({ includeHidden: true }))[0]
            }
        }

        cwd = cwd ?? profile.sessionOptions.cwd

        if (cwd && !fs.existsSync(cwd)) {
            console.warn('Ignoring non-existent CWD:', cwd)
            cwd = null
        }

        if (!cwd) {
            if (!this.config.store.terminal.alwaysUseWorkingDirectory) {
                if (this.app.activeTab instanceof TerminalTabComponent && this.app.activeTab.session) {
                    cwd = await this.app.activeTab.session.getWorkingDirectory()
                }
                if (this.app.activeTab instanceof SplitTabComponent) {
                    const focusedTab = this.app.activeTab.getFocusedTab()

                    if (focusedTab instanceof TerminalTabComponent && focusedTab.session) {
                        cwd = await focusedTab.session.getWorkingDirectory()
                    }
                }
            }
            cwd = cwd ?? this.config.store.terminal.workingDirectory
        }

        this.logger.info(`Starting profile ${profile.name}`, profile)
        const sessionOptions = {
            ...profile.sessionOptions,
            pauseAfterExit: pause,
            cwd: cwd ?? undefined,
        }

        const tab = this.openTabWithOptions(sessionOptions)
        if (profile.color) {
            (this.app.getParentTab(tab) ?? tab).color = profile.color
        }
        if (profile.disableDynamicTitle) {
            tab.enableDynamicTitle = false
            tab.setTitle(profile.name)
        }
        return tab
    }

    optionsFromShell (shell: Shell): SessionOptions {
        return {
            command: shell.command,
            args: shell.args ?? [],
            env: shell.env,
        }
    }

    /**
     * Open a terminal with custom session options
     */
    openTabWithOptions (sessionOptions: SessionOptions): TerminalTabComponent {
        if (sessionOptions.runAsAdministrator && this.uac.isAvailable) {
            sessionOptions = this.uac.patchSessionOptionsForUAC(sessionOptions)
        }
        this.logger.info('Using session options:', sessionOptions)

        return this.app.openNewTab(
            TerminalTabComponent,
            { sessionOptions }
        ) as TerminalTabComponent
    }

    private async getShells (): Promise<Shell[]> {
        const shellLists = await Promise.all(this.config.enabledServices(this.shellProviders).map(x => x.provide()))
        return shellLists.reduce((a, b) => a.concat(b), [])
    }

    private async reloadShells () {
        this.shells = new AsyncSubject<Shell[]>()
        const shells = await this.getShells()
        this.logger.debug('Shells list:', shells)
        this.shells.next(shells)
        this.shells.complete()
    }
}
