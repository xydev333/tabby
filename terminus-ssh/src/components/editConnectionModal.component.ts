/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component } from '@angular/core'
import { NgbModal, NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { ElectronService, HostAppService, ConfigService } from 'terminus-core'
import { PasswordStorageService } from '../services/passwordStorage.service'
import { SSHConnection, LoginScript, SSHAlgorithmType, ALGORITHM_BLACKLIST } from '../api'
import { PromptModalComponent } from './promptModal.component'
import { ALGORITHMS } from 'ssh2-streams/lib/constants'

/** @hidden */
@Component({
    template: require('./editConnectionModal.component.pug'),
})
export class EditConnectionModalComponent {
    connection: SSHConnection
    hasSavedPassword: boolean

    supportedAlgorithms: Record<string, string> = {}
    defaultAlgorithms: Record<string, string[]> = {}
    algorithms: Record<string, Record<string, boolean>> = {}

    constructor (
        public config: ConfigService,
        private modalInstance: NgbActiveModal,
        private electron: ElectronService,
        private hostApp: HostAppService,
        private passwordStorage: PasswordStorageService,
        private ngbModal: NgbModal,
    ) {
        for (const k of Object.values(SSHAlgorithmType)) {
            const supportedAlg = {
                [SSHAlgorithmType.KEX]: 'SUPPORTED_KEX',
                [SSHAlgorithmType.HOSTKEY]: 'SUPPORTED_SERVER_HOST_KEY',
                [SSHAlgorithmType.CIPHER]: 'SUPPORTED_CIPHER',
                [SSHAlgorithmType.HMAC]: 'SUPPORTED_HMAC',
            }[k]
            const defaultAlg = {
                [SSHAlgorithmType.KEX]: 'KEX',
                [SSHAlgorithmType.HOSTKEY]: 'SERVER_HOST_KEY',
                [SSHAlgorithmType.CIPHER]: 'CIPHER',
                [SSHAlgorithmType.HMAC]: 'HMAC',
            }[k]
            this.supportedAlgorithms[k] = ALGORITHMS[supportedAlg].filter(x => !ALGORITHM_BLACKLIST.includes(x))
            this.defaultAlgorithms[k] = ALGORITHMS[defaultAlg].filter(x => !ALGORITHM_BLACKLIST.includes(x))
        }
    }

    async ngOnInit () {
        this.hasSavedPassword = !!await this.passwordStorage.loadPassword(this.connection)
        this.connection.algorithms = this.connection.algorithms ?? {}
        this.connection.scripts = this.connection.scripts ?? []
        this.connection.auth = this.connection.auth ?? null

        for (const k of Object.values(SSHAlgorithmType)) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (!this.connection.algorithms[k]) {
                this.connection.algorithms[k] = this.defaultAlgorithms[k]
            }

            this.algorithms[k] = {}
            for (const alg of this.connection.algorithms[k]) {
                this.algorithms[k][alg] = true
            }
        }
    }

    async setPassword () {
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = `Password for ${this.connection.user}@${this.connection.host}`
        modal.componentInstance.password = true
        try {
            const result = await modal.result
            if (result?.value) {
                this.passwordStorage.savePassword(this.connection, result.value)
                this.hasSavedPassword = true
            }
        } catch { }
    }

    clearSavedPassword () {
        this.hasSavedPassword = false
        this.passwordStorage.deletePassword(this.connection)
    }

    selectPrivateKey () {
        this.electron.dialog.showOpenDialog(
            this.hostApp.getWindow(),
            {
                defaultPath: this.connection.privateKey,
                title: 'Select private key',
            }
        ).then(result => {
            if (!result.canceled) {
                this.connection.privateKey = result.filePaths[0]
            }
        })
    }

    save () {
        for (const k of Object.values(SSHAlgorithmType)) {
            this.connection.algorithms![k] = Object.entries(this.algorithms[k])
                .filter(([_, v]) => !!v)
                .map(([key, _]) => key)
        }
        this.modalInstance.close(this.connection)
    }

    cancel () {
        this.modalInstance.dismiss()
    }

    moveScriptUp (script: LoginScript) {
        if (!this.connection.scripts) {
            this.connection.scripts = []
        }
        const index = this.connection.scripts.indexOf(script)
        if (index > 0) {
            this.connection.scripts.splice(index, 1)
            this.connection.scripts.splice(index - 1, 0, script)
        }
    }

    moveScriptDown (script: LoginScript) {
        if (!this.connection.scripts) {
            this.connection.scripts = []
        }
        const index = this.connection.scripts.indexOf(script)
        if (index >= 0 && index < this.connection.scripts.length - 1) {
            this.connection.scripts.splice(index, 1)
            this.connection.scripts.splice(index + 1, 0, script)
        }
    }

    async deleteScript (script: LoginScript) {
        if (this.connection.scripts && (await this.electron.showMessageBox(
            this.hostApp.getWindow(),
            {
                type: 'warning',
                message: 'Delete this script?',
                detail: script.expect,
                buttons: ['Keep', 'Delete'],
                defaultId: 1,
            }
        )).response === 1) {
            this.connection.scripts = this.connection.scripts.filter(x => x !== script)
        }
    }

    addScript () {
        if (!this.connection.scripts) {
            this.connection.scripts = []
        }
        this.connection.scripts.push({ expect: '', send: '' })
    }
}
