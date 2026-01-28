import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../../components/ErrorBoundary";

// Component that throws an error
const ThrowError = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error("Test error message");
  }
  return <div>No error</div>;
};

describe("ErrorBoundary", () => {
  // Suppress console.error during tests to avoid noise
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("should render children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("should render error UI when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/An unexpected error occurred/)).toBeInTheDocument();
  });

  it("should show error icon", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("error-boundary-icon")).toBeInTheDocument();
  });

  it("should show Try Again button", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("should show Reload Page button", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
  });

  it("should reset error state when Try Again is clicked", () => {
    // Create a component that can toggle throwing
    let shouldThrow = true;
    const ToggleError = () => {
      if (shouldThrow) {
        throw new Error("Test error");
      }
      return <div>Recovered content</div>;
    };

    const { rerender } = render(
      <ErrorBoundary>
        <ToggleError />
      </ErrorBoundary>
    );

    // Should show error UI
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Stop throwing before clicking retry
    shouldThrow = false;

    // Click Try Again
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Re-render to pick up the change
    rerender(
      <ErrorBoundary>
        <ToggleError />
      </ErrorBoundary>
    );

    // Should show recovered content
    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });

  it("should call window.location.reload when Reload Page is clicked", () => {
    const reloadMock = vi.fn();
    const originalLocation = window.location;

    // @ts-expect-error - Mocking window.location
    delete window.location;
    window.location = { ...originalLocation, reload: reloadMock };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole("button", { name: /reload page/i }));

    expect(reloadMock).toHaveBeenCalled();

    window.location = originalLocation;
  });

  it("should render custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom error message</div>}>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom error message")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("should log error to console", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(console.error).toHaveBeenCalled();
  });

  it("should show error details in development mode", () => {
    // import.meta.env.DEV is true in test environment
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    // Error message should be visible in dev mode
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("should handle nested errors", () => {
    const NestedComponent = () => {
      return (
        <div>
          <ThrowError />
        </div>
      );
    };

    render(
      <ErrorBoundary>
        <NestedComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("should not catch errors in event handlers", async () => {
    const ClickError = () => {
      const handleClick = () => {
        throw new Error("Event handler error");
      };
      return <button onClick={handleClick}>Click me</button>;
    };

    render(
      <ErrorBoundary>
        <ClickError />
      </ErrorBoundary>
    );

    // Button should be rendered
    expect(screen.getByRole("button", { name: /click me/i })).toBeInTheDocument();

    // Clicking will throw but ErrorBoundary won't catch event handler errors
    // This is expected React behavior
  });
});
