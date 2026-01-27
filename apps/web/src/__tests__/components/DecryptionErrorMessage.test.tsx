import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecryptionErrorMessage } from "../../components/DecryptionErrorMessage";

describe("DecryptionErrorMessage", () => {
  it("should display error message when decryption fails", () => {
    render(<DecryptionErrorMessage />);

    // Should show error message
    expect(screen.getByText(/unable to decrypt/i)).toBeInTheDocument();
  });

  it("should show error icon", () => {
    render(<DecryptionErrorMessage />);

    // Should show an error indicator (SVG icon)
    const errorIcon = screen.getByTestId("decryption-error-icon");
    expect(errorIcon).toBeInTheDocument();
  });

  it("should not show retry button when onRetry is not provided", () => {
    render(<DecryptionErrorMessage />);

    // Retry button should not be present
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("should show retry button when onRetry is provided", () => {
    const onRetry = vi.fn();
    render(<DecryptionErrorMessage onRetry={onRetry} />);

    // Retry button should be visible
    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
  });

  it("should call onRetry when retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<DecryptionErrorMessage onRetry={onRetry} />);

    // Click retry button
    const retryButton = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    // onRetry should have been called
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("should have appropriate error styling", () => {
    render(<DecryptionErrorMessage />);

    // The container should have error-related styling
    const container = screen.getByTestId("decryption-error-container");
    expect(container).toHaveClass("text-red-400");
  });

  it("should show syncing message and yellow styling when syncing keys", () => {
    render(<DecryptionErrorMessage errorType="[Syncing keys...]" />);

    // Should show syncing message
    expect(screen.getByText(/syncing encryption keys/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for another member/i)).toBeInTheDocument();

    // Should have yellow styling
    const container = screen.getByTestId("decryption-error-container");
    expect(container).toHaveClass("text-yellow-400");
  });

  it("should show setup required message for encryption not set up", () => {
    render(<DecryptionErrorMessage errorType="[Encryption not set up - please re-register]" />);

    // Should show setup message
    expect(screen.getByText(/encryption not set up/i)).toBeInTheDocument();
    expect(screen.getByText(/please re-register/i)).toBeInTheDocument();
  });

  it("should not show retry button when syncing keys", () => {
    const onRetry = vi.fn();
    render(<DecryptionErrorMessage errorType="[Syncing keys...]" onRetry={onRetry} />);

    // Retry button should not be present during sync
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
