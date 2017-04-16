import { Observable } from 'rxjs/Observable'
import 'rxjs/add/operator/map'
import 'rxjs/add/operator/debounceTime'
import 'rxjs/add/operator/distinctUntilChanged'
import * as fs from 'fs-promise'
const fontManager = require('font-manager')
const equal = require('deep-equal')
const { exec } = require('child-process-promise')

import { Component, Inject } from '@angular/core'
import { ConfigService, HostAppService, Platform } from 'terminus-core'
import { TerminalColorSchemeProvider, ITerminalColorScheme } from '../api'


@Component({
    template: require('./terminalSettingsTab.pug'),
    styles: [require('./terminalSettingsTab.scss')],
})
export class TerminalSettingsTabComponent {
    fonts: string[] = []
    shells: string[] = []
    colorSchemes: ITerminalColorScheme[] = []
    equalComparator = equal
    editingColorScheme: ITerminalColorScheme
    schemeChanged = false

    constructor(
        public config: ConfigService,
        private hostApp: HostAppService,
        @Inject(TerminalColorSchemeProvider) private colorSchemeProviders: TerminalColorSchemeProvider[],
    ) { }

    async ngOnInit () {
        if (this.hostApp.platform == Platform.Windows) {
            let fonts = await new Promise<any[]>((resolve) => fontManager.findFonts({ monospace: true }, resolve))
            this.fonts = fonts.map(x => x.family)
            this.fonts.sort()
        }
        if (this.hostApp.platform == Platform.Linux) {
            exec('fc-list :spacing=mono').then((result) => {
                this.fonts = result.stdout
                    .split('\n')
                    .filter(x => !!x)
                    .map(x => x.split(':')[1].trim())
                    .map(x => x.split(',')[0].trim())
                this.fonts.sort()
            })

            this.shells = (await fs.readFile('/etc/shells', 'utf-8'))
                .split('\n')
                .map(x => x.trim())
                .filter(x => x && !x.startsWith('#'))
        }
        this.colorSchemes = (await Promise.all(this.colorSchemeProviders.map(x => x.getSchemes()))).reduce((a, b) => a.concat(b))
    }

    fontAutocomplete = (text$: Observable<string>) => {
        return text$
          .debounceTime(200)
          .distinctUntilChanged()
          .map(query => this.fonts.filter(v => new RegExp(query, 'gi').test(v)))
          .map(list => Array.from(new Set(list)))
    }

    shellAutocomplete = (text$: Observable<string>) => {
        return text$.map(_ => ['auto'].concat(this.shells))
    }

    editScheme (scheme: ITerminalColorScheme) {
        this.editingColorScheme = scheme
        this.schemeChanged = false
    }

    saveScheme () {
        let schemes = this.config.store.terminal.customColorSchemes
        schemes = schemes.filter(x => x !== this.editingColorScheme && x.name !== this.editingColorScheme.name)
        schemes.push(this.editingColorScheme)
        this.config.store.terminal.customColorSchemes = schemes
        this.config.save()
        this.cancelEditing()
    }

    cancelEditing () {
        this.editingColorScheme = null
    }

    deleteScheme (scheme: ITerminalColorScheme) {
        if (confirm(`Delete "${scheme.name}"?`)) {
            let schemes = this.config.store.terminal.customColorSchemes
            schemes = schemes.filter(x => x !== scheme)
            this.config.store.terminal.customColorSchemes = schemes
            this.config.save()
        }
    }

    isCustomScheme (scheme: ITerminalColorScheme) {
        return this.config.store.terminal.customColorSchemes.some(x => equal(x, scheme))
    }

    colorsTrackBy (index) {
        return index
    }
}
