import * as crypto from 'crypto'
import { promisify } from 'util'
import { Injectable, NgZone } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { AsyncSubject, Subject, Observable } from 'rxjs'
import { UnlockVaultModalComponent } from '../components/unlockVaultModal.component'
import { NotificationsService } from '../services/notifications.service'
import { wrapPromise } from 'utils'

const PBKDF_ITERATIONS = 100000
const PBKDF_DIGEST = 'sha512'
const PBKDF_SALT_LENGTH = 64 / 8
const CRYPT_ALG = 'aes-256-cbc'
const CRYPT_KEY_LENGTH = 256 / 8
const CRYPT_IV_LENGTH = 128 / 8

interface StoredVault {
    version: number
    contents: string
    keySalt: string
    iv: string
}

export interface VaultSecret {
    type: string
    key: Record<string, any>
    value: string
}

export interface Vault {
    config: any
    secrets: VaultSecret[]
}

function migrateVaultContent (content: any): Vault {
    return {
        config: content.config,
        secrets: content.secrets ?? [],
    }
}

function deriveVaultKey (passphrase: string, salt: Buffer): Promise<Buffer> {
    return promisify(crypto.pbkdf2)(
        Buffer.from(passphrase),
        salt,
        PBKDF_ITERATIONS,
        CRYPT_KEY_LENGTH,
        PBKDF_DIGEST,
    )
}

async function encryptVault (content: Vault, passphrase: string): Promise<StoredVault> {
    const keySalt = await promisify(crypto.randomBytes)(PBKDF_SALT_LENGTH)
    const iv = await promisify(crypto.randomBytes)(CRYPT_IV_LENGTH)
    const key = await deriveVaultKey(passphrase, keySalt)

    const plaintext = JSON.stringify(content)
    const cipher = crypto.createCipheriv(CRYPT_ALG, key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])

    return {
        version: 1,
        contents: encrypted.toString('base64'),
        keySalt: keySalt.toString('hex'),
        iv: iv.toString('hex'),
    }
}

async function decryptVault (vault: StoredVault, passphrase: string): Promise<Vault> {
    if (vault.version !== 1) {
        throw new Error(`Unsupported vault format version ${vault.version}`)
    }
    const keySalt = Buffer.from(vault.keySalt, 'hex')
    const key = await deriveVaultKey(passphrase, keySalt)
    const iv = Buffer.from(vault.iv, 'hex')
    const encrypted = Buffer.from(vault.contents, 'base64')

    const decipher = crypto.createDecipheriv(CRYPT_ALG, key, iv)
    const plaintext = decipher.update(encrypted, undefined, 'utf-8') + decipher.final('utf-8')
    return migrateVaultContent(JSON.parse(plaintext))
}

// Don't make it accessible through VaultService fields
let _rememberedPassphrase: string|null = null

@Injectable({ providedIn: 'root' })
export class VaultService {
    /** Fires once when the config is loaded */
    get ready$ (): Observable<boolean> { return this.ready }

    get contentChanged$ (): Observable<void> { return this.contentChanged }

    store: StoredVault|null = null
    private ready = new AsyncSubject<boolean>()
    private contentChanged = new Subject<void>()

    /** @hidden */
    private constructor (
        private zone: NgZone,
        private notifications: NotificationsService,
        private ngbModal: NgbModal,
    ) { }

    async setEnabled (enabled: boolean, passphrase?: string): Promise<void> {
        if (enabled) {
            if (!this.store) {
                await this.save(migrateVaultContent({}), passphrase)
            }
        } else {
            this.store = null
            this.contentChanged.next()
        }
    }

    isOpen (): boolean {
        return !!_rememberedPassphrase
    }

    async decrypt (storage: StoredVault, passphrase?: string): Promise<Vault> {
        if (!passphrase) {
            passphrase = await this.getPassphrase()
        }
        try {
            return wrapPromise(this.zone, decryptVault(storage, passphrase))
        } catch (e) {
            _rememberedPassphrase = null
            if (e.toString().includes('BAD_DECRYPT')) {
                this.notifications.error('Incorrect passphrase')
            }
            throw e
        }
    }

    async load (passphrase?: string): Promise<Vault|null> {
        if (!this.store) {
            return null
        }
        return this.decrypt(this.store, passphrase)
    }

    async encrypt (vault: Vault, passphrase?: string): Promise<StoredVault|null> {
        if (!passphrase) {
            passphrase = await this.getPassphrase()
        }
        if (_rememberedPassphrase) {
            _rememberedPassphrase = passphrase
        }
        return wrapPromise(this.zone, encryptVault(vault, passphrase))
    }

    async save (vault: Vault, passphrase?: string): Promise<void> {
        await this.ready$.toPromise()
        this.store = await this.encrypt(vault, passphrase)
        this.contentChanged.next()
    }

    async getPassphrase (): Promise<string> {
        if (!_rememberedPassphrase) {
            const modal = this.ngbModal.open(UnlockVaultModalComponent)
            const { passphrase, rememberFor } = await modal.result
            setTimeout(() => {
                _rememberedPassphrase = null
                // avoid multiple consequent prompts
            }, Math.min(1000, rememberFor * 60000))
            _rememberedPassphrase = passphrase
        }

        return _rememberedPassphrase!
    }

    async getSecret (type: string, key: Record<string, any>): Promise<VaultSecret|null> {
        await this.ready$.toPromise()
        const vault = await this.load()
        if (!vault) {
            return null
        }
        return vault.secrets.find(s => s.type === type && this.keyMatches(key, s)) ?? null
    }

    async addSecret (secret: VaultSecret): Promise<void> {
        await this.ready$.toPromise()
        const vault = await this.load()
        if (!vault) {
            return
        }
        vault.secrets = vault.secrets.filter(s => s.type !== secret.type || !this.keyMatches(secret.key, s))
        vault.secrets.push(secret)
        await this.save(vault)
    }

    async removeSecret (type: string, key: Record<string, any>): Promise<void> {
        await this.ready$.toPromise()
        const vault = await this.load()
        if (!vault) {
            return
        }
        vault.secrets = vault.secrets.filter(s => s.type !== type || !this.keyMatches(key, s))
        await this.save(vault)
    }

    private keyMatches (key: Record<string, any>, secret: VaultSecret): boolean {
        return Object.keys(key).every(k => secret.key[k] === key[k])
    }

    setStore (store: StoredVault): void {
        this.store = store
        this.ready.next(true)
        this.ready.complete()
    }

    isEnabled (): boolean {
        return !!this.store
    }
}
