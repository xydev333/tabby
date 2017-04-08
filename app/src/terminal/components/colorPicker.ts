import { Component, Input, Output, EventEmitter, HostListener, ViewChild } from '@angular/core'
import { NgbPopover } from '@ng-bootstrap/ng-bootstrap'


@Component({
    selector: 'color-picker',
    template: require('./colorPicker.pug'),
    styles: [require('./colorPicker.scss')],
})
export class ColorPickerComponent {
    @Input() model: string
    @Input() title: string
    @Output() modelChange = new EventEmitter<string>()
    @ViewChild('popover') popover: NgbPopover
    @ViewChild('input') input

    open () {
        setImmediate(() => {
            this.popover.open()
            setImmediate(() => {
                this.input.nativeElement.focus()
            })
        })
    }

    @HostListener('document:click', ['$event']) onOutsideClick ($event) {
        let windowRef = (<any>this.popover)._windowRef
        if (!windowRef) {
            return
        }
        if ($event.target !== windowRef.location.nativeElement &&
            !windowRef.location.nativeElement.contains($event.target)) {
            this.popover.close()
        }
    }

    onChange () {
        this.modelChange.emit(this.model)
    }
}
