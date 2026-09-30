import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BrandedLoader from '../components/ui/BrandedLoader';

describe('BrandedLoader', () => {
  it('shows the approved EduFusion mark with an accessible status label', () => {
    render(<BrandedLoader variant="screen" label="Checking your session" />);
    const status = screen.getByRole('status', { name: 'Checking your session' });
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveClass('branded-loader--screen');
    const mark = within(status).getByRole('presentation', { hidden: true });
    expect(mark).toHaveAttribute('src', '/brand/edufusion-mark-alpha.png');
    expect(within(status).getByText('Checking your session')).toBeInTheDocument();
    expect(status.querySelector('svg')).toBeNull();
  });
  it('defaults to the in-content panel size', () => {
    render(<BrandedLoader />);
    const status = screen.getByRole('status', { name: 'Loading' });
    expect(status).toHaveClass('branded-loader--panel');
    expect(status.querySelectorAll('.branded-loader__dots span')).toHaveLength(3);
  });
});
