import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

describe('Input component (phone_bd & otp_6)', () => {
  it('keeps local 01XXXXXXXXX visible in phone_bd on change and blur while submitting +8801XXXXXXXXX in FormData', () => {
    let submitted: FormData | null = null;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted = new FormData(e.currentTarget);
        }}
      >
        <Input id="phone" name="phone" variant="phone_bd" label="Phone Number" />
        <button type="submit">Submit</button>
      </form>,
    );

    const visibleInput = screen.getByLabelText(/phone number/i) as HTMLInputElement;
    expect(visibleInput).not.toHaveAttribute('name');

    fireEvent.change(visibleInput, { target: { value: '01712345678' } });
    fireEvent.blur(visibleInput);

    expect(visibleInput.value).toBe('01712345678');

    fireEvent.submit(visibleInput.closest('form')!);
    expect(submitted).not.toBeNull();
    expect(submitted!.get('phone')).toBe('+8801712345678');
  });

  it('strips pasted +880/880 prefix and non-digit characters in phone_bd', () => {
    const onChange = vi.fn();
    render(
      <form>
        <Input id="phone" name="phone" variant="phone_bd" label="Phone Number" onChange={onChange} />
      </form>,
    );

    const visibleInput = screen.getByLabelText(/phone number/i) as HTMLInputElement;

    fireEvent.change(visibleInput, { target: { value: '+8801712345678' } });
    expect(visibleInput.value).toBe('01712345678');

    fireEvent.change(visibleInput, { target: { value: '8801812345678' } });
    expect(visibleInput.value).toBe('01812345678');

    fireEvent.change(visibleInput, { target: { value: '017742590012dddddddd12' } });
    expect(visibleInput.value).toBe('01774259001212');
    expect(visibleInput.value).not.toContain('d');
    expect(visibleInput.value).not.toContain('+880');

    const hiddenInput = document.querySelector('input[type="hidden"][name="phone"]') as HTMLInputElement;
    expect(hiddenInput).toBeInTheDocument();
  });

  it('strips non-digits from otp_6 input', () => {
    render(<Input id="otp" name="otp" variant="otp_6" label="Code" />);
    const otpInput = screen.getByLabelText(/^code$/i) as HTMLInputElement;

    fireEvent.change(otpInput, { target: { value: '12a3b4567' } });
    expect(otpInput.value).toBe('123456');
  });

  it('renders aria-hidden required asterisk on required Input/otp_6/Checkbox and vertically centers error icon', () => {
    render(
      <div>
        <Input id="req-email" label="Email" required error="Enter a valid email." />
        <Input id="opt-note" label="Optional Note" />
        <Input id="req-otp" variant="otp_6" label="One-Time Code" required />
        <Checkbox id="req-terms" label="I agree to terms" required error="Consent required." />
      </div>,
    );

    const emailInput = screen.getByLabelText(/^email$/i);
    const emailLabel = document.querySelector('label[for="req-email"]');
    expect(emailInput).toBeRequired();
    expect(emailLabel?.textContent).toBe('Email');
    const emailStar = emailLabel?.parentElement?.querySelector('[aria-hidden="true"]');
    expect(emailStar).toHaveTextContent('*');

    const optLabel = document.querySelector('label[for="opt-note"]');
    expect(optLabel?.textContent).toBe('Optional Note');
    expect(optLabel?.parentElement?.querySelector('[aria-hidden="true"]')).toBeNull();

    expect(screen.getByLabelText(/^one-time code$/i)).toBeRequired();
    const otpLabel = document.querySelector('label[for="req-otp"]');
    expect(otpLabel?.textContent).toBe('One-Time Code');
    expect(otpLabel?.parentElement?.querySelector('[aria-hidden="true"]')).toHaveTextContent('*');

    const checkbox = screen.getByLabelText(/^i agree to terms$/i);
    const checkboxLabel = document.querySelector('label[for="req-terms"]');
    expect(checkbox).toBeRequired();
    expect(checkboxLabel?.textContent).toBe('I agree to terms');
    expect(checkboxLabel?.nextElementSibling).toHaveAttribute('aria-hidden', 'true');
    expect(checkboxLabel?.nextElementSibling).toHaveTextContent('*');

    const emailError = document.getElementById('req-email-error');
    expect(emailError).toHaveClass('flex', 'items-center');
    expect(emailError?.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5', 'shrink-0');
    expect(emailError?.querySelector('svg')).not.toHaveClass('mt-0.5');

    const checkboxError = document.getElementById('req-terms-error');
    expect(checkboxError).toHaveClass('flex', 'items-center');
    expect(checkboxError?.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5', 'shrink-0');
    expect(checkboxError?.querySelector('svg')).not.toHaveClass('mt-0.5');
  });
});
