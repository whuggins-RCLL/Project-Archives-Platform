import { ButtonHTMLAttributes, forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'outline';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const baseStyles = 'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0';

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-br from-primary to-brand-dark text-white shadow-sm hover:shadow-md hover:-translate-y-0.5',
  secondary: 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high',
  outline: 'bg-surface-container-lowest/80 text-primary border border-outline-variant/30 hover:bg-surface-container-low hover:border-primary/40',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-xs',
  md: 'px-4 py-2 text-sm',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    className = '',
    type = 'button',
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`.trim()}
      {...props}
    />
  );
});

export default Button;
