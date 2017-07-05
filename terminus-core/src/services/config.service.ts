import { Subject } from 'rxjs'
import * as yaml from 'js-yaml'
import * as path from 'path'
import * as fs from 'fs'
import { Injectable, Inject } from '@angular/core'
import { ConfigProvider } from '../api/configProvider'
import { ElectronService } from './electron.service'
import { HostAppService } from './hostApp.service'

const configMerge = (a, b) => require('deepmerge')(a, b, { arrayMerge: (_d, s) => s })

export class ConfigProxy {
    constructor (real: any, defaults: any) {
        for (let key in defaults) {
            if (
                defaults[key] instanceof Object &&
                !(defaults[key] instanceof Array) &&
                Object.keys(defaults[key]).length > 0 &&
                !defaults[key].__nonStructural
            ) {
                if (!real[key]) {
                    real[key] = {}
                }
                let proxy = new ConfigProxy(real[key], defaults[key])
                Object.defineProperty(
                    this,
                    key,
                    {
                        enumerable: true,
                        configurable: false,
                        get: () => proxy,
                    }
                )
            } else {
                Object.defineProperty(
                    this,
                    key,
                    {
                        enumerable: true,
                        configurable: false,
                        get: () => real[key] || defaults[key],
                        set: (value) => {
                            real[key] = value
                        }
                    }
                )
            }
        }
    }
}

@Injectable()
export class ConfigService {
    store: any
    changed$ = new Subject<void>()
    restartRequested: boolean
    private _store: any
    private path: string
    private defaults: any

    constructor (
        electron: ElectronService,
        hostApp: HostAppService,
        @Inject(ConfigProvider) configProviders: ConfigProvider[],
    ) {
        this.path = path.join(electron.app.getPath('userData'), 'config.yaml')
        this.defaults = configProviders.map(provider => {
            let defaults = {}
            if (provider.platformDefaults) {
                defaults = configMerge(defaults, provider.platformDefaults[hostApp.platform] || {})
            }
            if (provider.defaults) {
                defaults = configMerge(defaults, provider.defaults)
            }
            return defaults
        }).reduce(configMerge)
        this.load()
    }

    load (): void {
        if (fs.existsSync(this.path)) {
            this._store = yaml.safeLoad(fs.readFileSync(this.path, 'utf8'))
        } else {
            this._store = {}
        }
        this.store = new ConfigProxy(this._store, this.defaults)
    }

    save (): void {
        fs.writeFileSync(this.path, yaml.safeDump(this._store), 'utf8')
        this.emitChange()
    }

    emitChange (): void {
        this.changed$.next()
    }

    requestRestart (): void {
        this.restartRequested = true
    }
}
