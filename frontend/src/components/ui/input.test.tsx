import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

  it('renders otp_6 as full-width 6-column grid of rounded-xl cells and syncs cell entry/backspace with FormData', () => {
    const { container } = render(
      <form data-testid="otp-form">
        <Input id="code" name="code" variant="otp_6" label="One-time code" />
      </form>,
    );

    const grid = container.querySelector('.grid.w-full.grid-cols-6');
    expect(grid).toBeInTheDocument();

    const cells = [1, 2, 3, 4, 5, 6].map(
      (n) => screen.getByLabelText(`Digit ${n} of 6`) as HTMLInputElement,
    );
    expect(cells).toHaveLength(6);
    for (const cell of cells) {
      expect(cell).toHaveClass('w-full', 'rounded-xl');
      expect(cell.value).toBe('');
    }

    const form = screen.getByTestId('otp-form') as HTMLFormElement;

    fireEvent.change(cells[0], { target: { value: '4' } });
    fireEvent.change(cells[1], { target: { value: '9' } });
    expect(cells.map((c) => c.value)).toEqual(['4', '9', '', '', '', '']);
    expect(new FormData(form).get('code')).toBe('49');

    fireEvent.keyDown(cells[1], { key: 'Backspace' });
    expect(cells.map((c) => c.value)).toEqual(['4', '', '', '', '', '']);
    expect(new FormData(form).get('code')).toBe('4');

    fireEvent.paste(cells[0], {
      clipboardData: { getData: () => '123456' },
    });
    expect(cells.map((c) => c.value)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new FormData(form).get('code')).toBe('123456');

    fireEvent.keyDown(cells[5], { key: 'Backspace' });
    expect(cells.map((c) => c.value)).toEqual(['1', '2', '3', '4', '5', '']);
    expect(new FormData(form).get('code')).toBe('12345');

    fireEvent.keyDown(cells[0], { key: 'Delete' });
    expect(cells.map((c) => c.value)).toEqual(['2', '3', '4', '5', '', '']);
    expect(new FormData(form).get('code')).toBe('2345');
  });

  it('synchronizes controlled otp_6 value, onChange, displayed cells, and FormData', () => {
    function ControlledOtpForm() {
      const [code, setCode] = useState('12');
      return (
        <form data-testid="controlled-otp-form">
          <Input
            id="ctrl-otp"
            name="code"
            variant="otp_6"
            label="Controlled code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <output data-testid="controlled-state">{code}</output>
        </form>
      );
    }

    render(<ControlledOtpForm />);
    const form = screen.getByTestId('controlled-otp-form') as HTMLFormElement;
    const cells = [1, 2, 3, 4, 5, 6].map(
      (n) => screen.getByLabelText(`Digit ${n} of 6`) as HTMLInputElement,
    );

    expect(cells.map((c) => c.value)).toEqual(['1', '2', '', '', '', '']);
    expect(new FormData(form).get('code')).toBe('12');

    fireEvent.change(cells[2], { target: { value: '8' } });
    expect(screen.getByTestId('controlled-state')).toHaveTextContent('128');
    expect(cells.map((c) => c.value)).toEqual(['1', '2', '8', '', '', '']);
    expect(new FormData(form).get('code')).toBe('128');

    fireEvent.keyDown(cells[2], { key: 'Backspace' });
    expect(screen.getByTestId('controlled-state')).toHaveTextContent('12');
    expect(cells.map((c) => c.value)).toEqual(['1', '2', '', '', '', '']);
    expect(new FormData(form).get('code')).toBe('12');
  });

  it('restores displayed otp_6 cells and FormData to defaultValue on form.reset()', () => {
    render(
      <form data-testid="reset-otp-form">
        <Input
          id="reset-otp"
          name="code"
          variant="otp_6"
          label="Resettable code"
          defaultValue="123456"
        />
      </form>,
    );

    const form = screen.getByTestId('reset-otp-form') as HTMLFormElement;
    const cells = [1, 2, 3, 4, 5, 6].map(
      (n) => screen.getByLabelText(`Digit ${n} of 6`) as HTMLInputElement,
    );

    expect(cells.map((c) => c.value)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new FormData(form).get('code')).toBe('123456');

    fireEvent.keyDown(cells[5], { key: 'Backspace' });
    fireEvent.change(cells[0], { target: { value: '9' } });
    expect(cells.map((c) => c.value)).toEqual(['9', '2', '3', '4', '5', '']);
    expect(new FormData(form).get('code')).toBe('92345');

    act(() => {
      form.reset();
    });

    expect(cells.map((c) => c.value)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new FormData(form).get('code')).toBe('123456');
  });

  it('renders EyeOffIcon with an inner pupil circle when toggling password visibility', () => {
    render(<Input id="pw" name="password" variant="password" label="Password" />);
    const toggle = screen.getByRole('button', { name: /show password/i });
    fireEvent.click(toggle);

    const hideToggle = screen.getByRole('button', { name: /hide password/i });
    const pupil = hideToggle.querySelector('svg circle');
    expect(pupil).toBeInTheDocument();
    expect(pupil).toHaveAttribute('cx', '12');
    expect(pupil).toHaveAttribute('cy', '12');
    expect(pupil).toHaveAttribute('r', '3');
    expect(hideToggle.querySelector('svg path[d="M2 2l20 20"]')).toBeInTheDocument();
  });
});
