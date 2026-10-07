import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface Props {
  email: string;
  password: string;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  /** Whether this is a new password, as on sign-up: the field then takes at least 8 characters, as Supabase Auth requires. */
  newPassword?: boolean;
}

export function AuthenticationForm({ email, onEmailChange, onPasswordChange, password, newPassword }: Props) {
  return (
    <>
      <div className="grid w-full items-center gap-1.5">
        <Label className={'leading-5'} htmlFor="email">
          Email address
        </Label>
        <Input
          type="email"
          id="email"
          autoComplete={'username'}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
        />
      </div>
      <div className="grid w-full items-center gap-1.5">
        <Label className={'leading-5'} htmlFor="password">
          Password
        </Label>
        <Input
          type="password"
          id="password"
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={newPassword ? 8 : undefined}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
        />
      </div>
    </>
  );
}
