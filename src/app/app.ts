// Polyfill for environments without matchMedia (e.g. jsdom test runner).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as unknown as MediaQueryList;
}

import { Component, AfterViewInit, OnDestroy, signal } from '@angular/core';
import { EyeSceneComponent } from './features/eye-scene/eye-scene.component';
import { BackgroundSceneComponent } from './features/background-scene/background-scene.component';
import { TiltCardDirective } from './shared/tilt-card.directive';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface Service { number: string; title: string; description: string; icon: string; }
interface Condition { title: string; description: string; icon: string; }
interface Doctor { name: string; role: string; quals: string; exp: string; photo: string; }
interface HeroPoint { title: string; text: string; }
interface Stat { value: string; text: string; progress: number; }
interface AboutFeature { icon: string; title: string; text: string; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EyeSceneComponent, BackgroundSceneComponent, TiltCardDirective],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit, OnDestroy {
  mobileOpen = signal(false);

  heroPoints: HeroPoint[] = [
    {
      title: 'Expert Care for Healthy Eyes',
      text: 'Comprehensive examinations and personalized treatment plans guided by experienced specialists.'
    },
    {
      title: 'Optimizing Your Visual Potential',
      text: 'Advanced diagnostics and modern corrective solutions tailored to your lifestyle.'
    },
    {
      title: 'Empowering Your Visual Experience',
      text: 'Patient-first care that helps you see, work and live with confidence.'
    }
  ];

  services: Service[] = [
    { number: '01', title: 'Comprehensive Eye Examination', description: 'Complete vision and eye-health assessment using modern diagnostic tools.', icon: '◉' },
    { number: '02', title: 'Cataract Treatment', description: 'Diagnosis and modern surgical solutions for clear, restored vision.', icon: '◎' },
    { number: '03', title: 'Retina Care', description: 'Specialized diagnosis and treatment for retinal conditions.', icon: '◈' },
    { number: '04', title: 'Glaucoma Treatment', description: 'Early detection and long-term management to protect your sight.', icon: '◇' },
    { number: '05', title: 'LASIK and Vision Correction', description: 'Personalized refractive solutions for lasting visual freedom.', icon: '✦' },
    { number: '06', title: 'Pediatric Eye Care', description: 'Gentle, specialized care for children’s developing vision.', icon: '◉' }
  ];

  conditions: Condition[] = [
    { title: 'Myopia', description: 'Nearsightedness causing distant objects to appear blurry.', icon: '◐' },
    { title: 'Hyperopia', description: 'Farsightedness making close objects difficult to focus on.', icon: '◑' },
    { title: 'Cataract', description: 'Clouding of the lens leading to blurred or dim vision.', icon: '◯' },
    { title: 'Glaucoma', description: 'Increased eye pressure that can damage the optic nerve.', icon: '◇' },
    { title: 'Dry Eye', description: 'Insufficient or poor-quality tears causing irritation and discomfort.', icon: '≈' },
    { title: 'Diabetic Retinopathy', description: 'Diabetes-related damage to retinal blood vessels.', icon: '✚' }
  ];

  doctors: Doctor[] = [
    { name: 'Dr. Ananya Sharma', role: 'Senior Ophthalmologist', quals: 'MBBS, MS (Ophthalmology)', exp: '14+ years experience', photo: '/doctors/ananya.jpg' },
    { name: 'Dr. Rohan Mehta', role: 'Retina Specialist', quals: 'MBBS, DNB, Fellowship in Retina', exp: '11+ years experience', photo: '/doctors/rohan.jpg' },
    { name: 'Dr. Priya Nair', role: 'Pediatric Ophthalmologist', quals: 'MBBS, MD, Fellowship in Pediatric Eye Care', exp: '9+ years experience', photo: '/doctors/priya.jpg' }
  ];

  stats: Stat[] = [
    {
      value: '02%',
      text: 'of routine eye exams reveal a condition that benefits from early specialist care.',
      progress: 22
    },
    {
      value: '16%',
      text: 'of adults live with an unaddressed vision change that a yearly check-up can catch.',
      progress: 58
    }
  ];

  aboutFeatures: AboutFeature[] = [
    { icon: '◎', title: 'Enhancing Your Sight', text: 'Advanced eye-care solutions for improved vision and a better quality of life.' },
    { icon: '◇', title: 'BrightFocus Visionary', text: 'Putting your eye health first with personalized, preventive care.' },
    { icon: '✦', title: 'Crystal-Clear Vision', text: 'Experience the utmost clarity and precision in vision with our expert solutions.' }
  ];

  ngAfterViewInit() {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.from('.hero-content > *', { y: 30, opacity: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out' });
    gsap.from('.hero-visual', { scale: 0.94, opacity: 0, duration: 1.2, ease: 'power3.out', delay: 0.2 });

    gsap.to('.float-card', { y: -8, duration: 2.8, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.45 });

    // Ambient background motion: the outer backdrop panels lag behind the
    // scroll (depth) and the hero auras drift on slow orbits.
    gsap.to('.backdrop-shape', {
      y: 170,
      ease: 'none',
      scrollTrigger: { trigger: 'main', start: 'top top', end: '+=1600', scrub: 1.1 }
    });

    gsap.to('.aura-teal', { x: 26, y: -18, duration: 7, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    gsap.to('.aura-amber', { x: -22, y: 14, duration: 8.5, ease: 'sine.inOut', yoyo: true, repeat: -1 });

    document.querySelectorAll('.reveal').forEach((el) => {
      gsap.fromTo(el, { y: 24 }, {
        y: 0, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 92%', once: true }
      });
    });
  }

  ngOnDestroy() {
    ScrollTrigger.getAll().forEach(t => t.kill());
    gsap.killTweensOf('.aura-teal, .aura-amber, .float-card');
  }
}
