import { BehaviorSubject, Observable } from 'rxjs'
import * as semver from 'semver'

import { Component, Input } from '@angular/core'
import { ConfigService } from 'terminus-core'
import { IPluginInfo, PluginManagerService } from '../services/pluginManager.service'

enum BusyState { Installing, Uninstalling }

@Component({
    template: require('./pluginsSettingsTab.component.pug'),
    styles: [require('./pluginsSettingsTab.component.scss')],
})
export class PluginsSettingsTabComponent {
    BusyState = BusyState
    @Input() availablePlugins$: Observable<IPluginInfo[]>
    @Input() availablePluginsQuery$ = new BehaviorSubject<string>('')
    @Input() availablePluginsReady = false
    @Input() knownUpgrades: {[id: string]: IPluginInfo} = {}
    @Input() busy: {[id: string]: BusyState} = {}
    @Input() erroredPlugin: string
    @Input() errorMessage: string

    constructor (
        private config: ConfigService,
        public pluginManager: PluginManagerService
    ) {
    }

    ngOnInit () {
        this.availablePlugins$ = this.availablePluginsQuery$
            .debounceTime(200)
            .distinctUntilChanged()
            .flatMap(query => {
                this.availablePluginsReady = false
                return this.pluginManager.listAvailable(query).do(() => {
                    this.availablePluginsReady = true
                })
            })
        this.availablePlugins$.first().subscribe(available => {
            for (let plugin of this.pluginManager.installedPlugins) {
                this.knownUpgrades[plugin.name] = available.find(x => x.name === plugin.name && semver.gt(x.version, plugin.version))
            }
        })
    }

    searchAvailable (query: string) {
        this.availablePluginsQuery$.next(query)
    }

    isAlreadyInstalled (plugin: IPluginInfo): boolean {
        return this.pluginManager.installedPlugins.some(x => x.name === plugin.name)
    }

    async installPlugin (plugin: IPluginInfo): Promise<void> {
        this.busy[plugin.name] = BusyState.Installing
        try {
            await this.pluginManager.installPlugin(plugin)
            delete this.busy[plugin.name]
            this.config.requestRestart()
        } catch (err) {
            this.erroredPlugin = plugin.name
            this.errorMessage = err
            delete this.busy[plugin.name]
            throw err
        }
    }

    async uninstallPlugin (plugin: IPluginInfo): Promise<void> {
        this.busy[plugin.name] = BusyState.Uninstalling
        try {
            await this.pluginManager.uninstallPlugin(plugin)
            delete this.busy[plugin.name]
            this.config.requestRestart()
        } catch (err) {
            this.erroredPlugin = plugin.name
            this.errorMessage = err
            delete this.busy[plugin.name]
            throw err
        }
    }

    async upgradePlugin (plugin: IPluginInfo): Promise<void> {
        return this.installPlugin(this.knownUpgrades[plugin.name])
    }
}
