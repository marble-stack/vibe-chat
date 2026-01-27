import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecryptionErrorMessage } from '../../components/DecryptionErrorMessage';

describe('DecryptionErrorMessage', () => {
  it('should display error message when decryption fails', () => {
    render(<DecryptionErrorMessage />);

    // Should show error message
    expect(screen.getByText(/failed to decrypt/i)).toBeInTheDocument();
  });

  it('should show error icon', () => {
    render(<DecryptionErrorMessage />);

    // Should show an error indicator (SVG icon)
    const errorIcon = screen.getByTestId('decryption-error-icon');
    expect(errorIcon).toBeInTheDocument();
  });

  it('should not show retry button when onRetry is not provided', () => {
    render(<DecryptionErrorMessage />);

    // Retry button should not be present
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('should show retry button when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(<DecryptionErrorMessage onRetry={onRetry} />);

    // Retry button should be visible
    const retryButton = screen.getByRole('button', { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
  });

  it('should call onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<DecryptionErrorMessage onRetry={onRetry} />);

    // Click retry button
    const retryButton = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);

    // onRetry should have been called
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should have appropriate error styling', () => {
    render(<DecryptionErrorMessage />);

    // The container should have error-related styling
    const container = screen.getByTestId('decryption-error-container');
    expect(container).toHaveClass('text-red-400');
  });
});
