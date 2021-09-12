import axios from 'axios'
import { Observable, from, forkJoin, map } from 'rxjs'
import { Injectable, Inject } from '@angular/core'
import { Logger, LogService, PlatformService, BOOTSTRAP_DATA, BootstrapData, PluginInfo } from 'tabby-core'

const OFFICIAL_NPM_ACCOUNT = 'eugenepankov'

const BLACKLIST = [
    'terminus-shell-selector', // superseded by profiles
]

@Injectable({ providedIn: 'root' })
export class PluginManagerService {
    logger: Logger
    userPluginsPath: string
    installedPlugins: PluginInfo[]

    private constructor (
        log: LogService,
        private platform: PlatformService,
        @Inject(BOOTSTRAP_DATA) bootstrapData: BootstrapData,
    ) {
        this.logger = log.create('pluginManager')
        this.installedPlugins = [...bootstrapData.installedPlugins]
        this.installedPlugins.sort((a, b) => a.name.localeCompare(b.name))
        this.userPluginsPath = bootstrapData.userPluginsPath
    }

    listAvailable (query?: string): Observable<PluginInfo[]> {
        return forkJoin(
            this._listAvailableInternal('tabby-', 'tabby-plugin', query),
            this._listAvailableInternal('terminus-', 'terminus-plugin', query),
        ).pipe(map(x => x.reduce((a, b) => a.concat(b), [])))
    }

    _listAvailableInternal (namePrefix: string, keyword: string, query?: string): Observable<PluginInfo[]> {
        return from(
            axios.get(`https://www.npmjs.com/search?q=keywords%3A${keyword}+${encodeURIComponent(query ?? '')}&from=0&size=1000`, {
                headers: {
                    'x-spiferack': '1',
                },
            })
        ).pipe(
            map(response => response.data.objects
                .filter(item => !item.keywords?.includes('tabby-dummy-transition-plugin'))
                .map(item => ({
                    name: item.package.name.substring(namePrefix.length),
                    packageName: item.package.name,
                    description: item.package.description,
                    version: item.package.version,
                    homepage: item.package.links.homepage,
                    author: (item.package.author || {}).name,
                    isOfficial: item.package.publisher.name === OFFICIAL_NPM_ACCOUNT,
                }))
            ),
            map(plugins => plugins.filter(x => x.packageName.startsWith(namePrefix))),
            map(plugins => plugins.filter(x => !BLACKLIST.includes(x.packageName))),
            map(plugins => plugins.sort((a, b) => a.name.localeCompare(b.name))),
        )
    }

    async installPlugin (plugin: PluginInfo): Promise<void> {
        try {
            await this.platform.installPlugin(plugin.packageName, plugin.version)
            this.installedPlugins = this.installedPlugins.filter(x => x.packageName !== plugin.packageName)
            this.installedPlugins.push(plugin)
        } catch (err) {
            this.logger.error(err)
            throw err
        }
    }

    async uninstallPlugin (plugin: PluginInfo): Promise<void> {
        try {
            await this.platform.uninstallPlugin(plugin.packageName)
            this.installedPlugins = this.installedPlugins.filter(x => x.packageName !== plugin.packageName)
        } catch (err) {
            this.logger.error(err)
            throw err
        }
    }
}
