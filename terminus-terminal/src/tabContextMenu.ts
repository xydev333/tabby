import { MenuItemConstructorOptions } from 'electron'
import { Injectable, NgZone, Optional, Inject } from '@angular/core'
import { ConfigService, BaseTabComponent, TabContextMenuItemProvider, TabHeaderComponent, SplitTabComponent, NotificationsService } from 'terminus-core'
import { TerminalTabComponent } from './components/terminalTab.component'
import { UACService } from './services/uac.service'
import { TerminalService } from './services/terminal.service'
import { BaseTerminalTabComponent } from './api/baseTerminalTab.component'
import { TerminalContextMenuItemProvider } from './api/contextMenuProvider'

/** @hidden */
@Injectable()
export class SaveAsProfileContextMenu extends TabContextMenuItemProvider {
    constructor (
        private config: ConfigService,
        private zone: NgZone,
        private notifications: NotificationsService,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent, _tabHeader?: TabHeaderComponent): Promise<MenuItemConstructorOptions[]> {
        if (!(tab instanceof TerminalTabComponent)) {
            return []
        }
        const items: MenuItemConstructorOptions[] = [
            {
                label: 'Save as profile',
                click: () => this.zone.run(async () => {
                    const profile = {
                        sessionOptions: {
                            ...tab.sessionOptions,
                            cwd: await tab.session?.getWorkingDirectory() ?? tab.sessionOptions.cwd,
                        },
                        name: tab.sessionOptions.command,
                    }
                    this.config.store.terminal.profiles = [
                        ...this.config.store.terminal.profiles,
                        profile,
                    ]
                    this.config.save()
                    this.notifications.info('Saved')
                }),
            },
        ]

        return items
    }
}

/** @hidden */
@Injectable()
export class NewTabContextMenu extends TabContextMenuItemProvider {
    weight = 10

    constructor (
        public config: ConfigService,
        private zone: NgZone,
        private terminalService: TerminalService,
        private uac: UACService,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent, tabHeader?: TabHeaderComponent): Promise<MenuItemConstructorOptions[]> {
        const profiles = await this.terminalService.getProfiles()

        const items: MenuItemConstructorOptions[] = [
            {
                label: 'New terminal',
                click: () => this.zone.run(() => {
                    this.terminalService.openTabWithOptions((tab as any).sessionOptions)
                }),
            },
            {
                label: 'New with profile',
                submenu: profiles.map(profile => ({
                    label: profile.name,
                    click: () => this.zone.run(async () => {
                        let workingDirectory = this.config.store.terminal.workingDirectory
                        if (this.config.store.terminal.alwaysUseWorkingDirectory !== true && tab instanceof TerminalTabComponent) {
                            workingDirectory = await tab.session?.getWorkingDirectory()
                        }
                        await this.terminalService.openTab(profile, workingDirectory)
                    }),
                })),
            },
        ]

        if (this.uac.isAvailable) {
            items.push({
                label: 'New admin tab',
                submenu: profiles.map(profile => ({
                    label: profile.name,
                    click: () => this.zone.run(async () => {
                        this.terminalService.openTabWithOptions({
                            ...profile.sessionOptions,
                            runAsAdministrator: true,
                        })
                    }),
                })),
            })
        }

        if (tab instanceof TerminalTabComponent && tabHeader && this.uac.isAvailable) {
            items.push({
                label: 'Duplicate as administrator',
                click: () => this.zone.run(async () => {
                    this.terminalService.openTabWithOptions({
                        ...tab.sessionOptions,
                        runAsAdministrator: true,
                    })
                }),
            })
        }

        if (tab instanceof BaseTerminalTabComponent && tab.parent instanceof SplitTabComponent && tab.parent.getAllTabs().length > 1) {
            items.push({
                label: 'Focus all panes',
                click: () => this.zone.run(() => {
                    tab.focusAllPanes()
                }),
            })
        }

        if (tab instanceof TerminalTabComponent && tab.session?.supportsWorkingDirectory()) {
            items.push({
                label: 'Copy current path',
                click: () => this.zone.run(() => tab.copyCurrentPath()),
            })
        }

        return items
    }
}

/** @hidden */
@Injectable()
export class CopyPasteContextMenu extends TabContextMenuItemProvider {
    weight = -10

    constructor (
        private zone: NgZone,
        private notifications: NotificationsService,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent, tabHeader?: TabHeaderComponent): Promise<MenuItemConstructorOptions[]> {
        if (tabHeader) {
            return []
        }
        if (tab instanceof BaseTerminalTabComponent) {
            return [
                {
                    label: 'Copy',
                    click: (): void => {
                        this.zone.run(() => {
                            setTimeout(() => {
                                tab.frontend?.copySelection()
                                this.notifications.notice('Copied')
                            })
                        })
                    },
                },
                {
                    label: 'Paste',
                    click: (): void => {
                        this.zone.run(() => tab.paste())
                    },
                },
            ]
        }
        return []
    }
}

/** @hidden */
@Injectable()
export class LegacyContextMenu extends TabContextMenuItemProvider {
    weight = 1

    constructor (
        @Optional() @Inject(TerminalContextMenuItemProvider) protected contextMenuProviders: TerminalContextMenuItemProvider[]|null,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent, _tabHeader?: TabHeaderComponent): Promise<MenuItemConstructorOptions[]> {
        if (!this.contextMenuProviders) {
            return []
        }
        if (tab instanceof BaseTerminalTabComponent) {
            let items: MenuItemConstructorOptions[] = []
            for (const p of this.contextMenuProviders) {
                items = items.concat(await p.getItems(tab))
            }
            return items
        }
        return []
    }
}
