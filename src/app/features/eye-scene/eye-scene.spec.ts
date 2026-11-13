import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EyeSceneComponent } from './eye-scene.component';

describe('EyeSceneComponent', () => {
  let component: EyeSceneComponent;
  let fixture: ComponentFixture<EyeSceneComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EyeSceneComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EyeSceneComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
