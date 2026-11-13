import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';

@Directive({
  selector: '[appTiltCard]',
  standalone: true,
  host: {
    '(pointerenter)': 'onEnter($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerleave)': 'onLeave()'
  }
})
export class TiltCardDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);

  private target = { rx: 0, ry: 0, mx: 50, my: 50 };
  private current = { rx: 0, ry: 0, mx: 50, my: 50 };
  private hovering = false;
  private raf = 0;

  ngOnInit() {
    const e = this.el.nativeElement;
    e.style.transformStyle = 'preserve-3d';
    e.style.willChange = 'transform';
  }

  onEnter(ev: PointerEvent) {
    this.hovering = true;
    this.onMove(ev);
    this.tick();
  }

  onMove(ev: PointerEvent) {
    const rect = this.el.nativeElement.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    this.target.ry = (x - 0.5) * 16;
    this.target.rx = (0.5 - y) * 16;
    this.target.mx = x * 100;
    this.target.my = y * 100;
  }

  onLeave() {
    this.hovering = false;
    this.target = { rx: 0, ry: 0, mx: 50, my: 50 };
    this.tick();
  }

  private tick = () => {
    cancelAnimationFrame(this.raf);
    const step = () => {
      this.current.rx += (this.target.rx - this.current.rx) * 0.14;
      this.current.ry += (this.target.ry - this.current.ry) * 0.14;
      this.current.mx += (this.target.mx - this.current.mx) * 0.18;
      this.current.my += (this.target.my - this.current.my) * 0.18;

      const e = this.el.nativeElement;
      e.style.setProperty('--rotate-x', `${this.current.rx.toFixed(2)}deg`);
      e.style.setProperty('--rotate-y', `${this.current.ry.toFixed(2)}deg`);
      e.style.setProperty('--mouse-x', `${this.current.mx.toFixed(1)}%`);
      e.style.setProperty('--mouse-y', `${this.current.my.toFixed(1)}%`);

      const settled = !this.hovering &&
        Math.abs(this.current.rx) < 0.05 &&
        Math.abs(this.current.ry) < 0.05 &&
        Math.abs(this.current.mx - 50) < 0.5 &&
        Math.abs(this.current.my - 50) < 0.5;

      if (this.hovering || !settled) {
        this.raf = requestAnimationFrame(step);
      }
    };
    this.raf = requestAnimationFrame(step);
  };

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
  }
}