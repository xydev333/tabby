/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import type { MenuItemConstructorOptions } from 'electron'
import { Component, Input, Optional, Inject, HostBinding, HostListener, ViewChild, ElementRef } from '@angular/core'
import { SortableComponent } from 'ng2-dnd'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { TabContextMenuItemProvider } from '../api/tabContextMenuProvider'
import { BaseTabComponent } from './baseTab.component'
import { RenameTabModalComponent } from './renameTabModal.component'
import { HotkeysService } from '../services/hotkeys.service'
import { ElectronService } from '../services/electron.service'
import { AppService } from '../services/app.service'
import { HostAppService, Platform } from '../services/hostApp.service'
import { ConfigService } from '../services/config.service'

/** @hidden */
export interface SortableComponentProxy {
    setDragHandle: (_: HTMLElement) => void
}

/** @hidden */
@Component({
    selector: 'tab-header',
    template: require('./tabHeader.component.pug'),
    styles: [require('./tabHeader.component.scss')],
})
export class TabHeaderComponent {
    @Input() index: number
    @Input() @HostBinding('class.active') active: boolean
    @Input() @HostBinding('class.has-activity') hasActivity: boolean
    @Input() tab: BaseTabComponent
    @Input() progress: number|null
    @ViewChild('handle') handle?: ElementRef

    private constructor (
        public app: AppService,
        public config: ConfigService,
        private electron: ElectronService,
        private hostApp: HostAppService,
        private ngbModal: NgbModal,
        private hotkeys: HotkeysService,
        @Inject(SortableComponent) private parentDraggable: SortableComponentProxy,
        @Optional() @Inject(TabContextMenuItemProvider) protected contextMenuProviders: TabContextMenuItemProvider[],
    ) {
        this.hotkeys.matchedHotkey.subscribe((hotkey) => {
            if (this.app.activeTab === this.tab) {
                if (hotkey === 'rename-tab') {
                    this.showRenameTabModal()
                }
            }
        })
        this.contextMenuProviders.sort((a, b) => a.weight - b.weight)
    }

    ngOnInit () {
        this.tab.progress$.subscribe(progress => {
            this.progress = progress
        })
    }

    ngAfterViewInit () {
        if (this.handle && this.hostApp.platform === Platform.macOS) {
            this.parentDraggable.setDragHandle(this.handle.nativeElement)
        }
    }

    showRenameTabModal (): void {
        const modal = this.ngbModal.open(RenameTabModalComponent)
        modal.componentInstance.value = this.tab.customTitle || this.tab.title
        modal.result.then(result => {
            this.tab.setTitle(result)
            this.tab.customTitle = result
        }).catch(() => null)
    }

    async buildContextMenu (): Promise<MenuItemConstructorOptions[]> {
        let items: MenuItemConstructorOptions[] = []
        for (const section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(this.tab, this)))) {
            items.push({ type: 'separator' })
            items = items.concat(section)
        }
        return items.slice(1)
    }

    @HostBinding('class.flex-width') get isFlexWidthEnabled (): boolean {
        return this.config.store.appearance.flexTabs
    }

    @HostListener('dblclick') onDoubleClick (): void {
        this.showRenameTabModal()
    }

    @HostListener('mousedown', ['$event']) async onMouseDown ($event: MouseEvent) {
        if ($event.which === 2) {
            $event.preventDefault()
        }
    }

    @HostListener('mouseup', ['$event']) async onMouseUp ($event: MouseEvent) {
        if ($event.which === 2) {
            this.app.closeTab(this.tab, true)
        }
    }

    @HostListener('auxclick', ['$event']) async onAuxClick ($event: MouseEvent) {
        if ($event.which === 3) {
            $event.preventDefault()

            const contextMenu = this.electron.remote.Menu.buildFromTemplate(await this.buildContextMenu())

            contextMenu.popup({
                x: $event.pageX,
                y: $event.pageY,
            })
        }
    }
}
