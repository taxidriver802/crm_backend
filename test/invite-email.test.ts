import { buildInviteEmail } from '../src/lib/invite-email';

describe('buildInviteEmail', () => {
  it('uses the inviting company name, mark, palette, and slug', () => {
    const message = buildInviteEmail({
      firstName: 'Alex',
      inviterName: 'Pat Owner',
      inviteUrl: 'https://app.example.com/accept-invite?token=abc',
      companyName: 'Invite Co',
      companySlug: 'invite-co',
      role: 'agent',
      paletteId: 'azure',
      markId: 'home',
    });

    expect(message.subject).toBe('You’ve been invited to join Invite Co');
    expect(message.text).toContain('Pat Owner invited you to join Invite Co as Agent.');
    expect(message.text).toContain('Company login id: invite-co');
    expect(message.html).not.toContain('Rooftop Realty');
    expect(message.html).toContain('Invite Co');
    expect(message.html).toContain('invite-co');
    expect(message.html).toContain('#2563eb');
    expect(message.html).toContain('M3 10.5 12 3l9 7.5');
    expect(message.html).toContain('<svg');
  });

  it('uses an uploaded logo and falls back to initials for the default mark', () => {
    const withLogo = buildInviteEmail({
      firstName: 'Alex',
      inviteUrl: 'https://app.example.com/accept-invite?token=abc',
      companyName: 'North Star',
      companySlug: 'north-star',
      role: 'admin',
      logoUrl: 'https://app.example.com/api/public/companies/north-star/logo',
      markId: 'product',
    });

    expect(withLogo.html).toContain(
      'src="https://app.example.com/api/public/companies/north-star/logo"'
    );
    expect(withLogo.html).not.toContain('>NS<');

    const initials = buildInviteEmail({
      firstName: 'Alex',
      inviteUrl: 'https://app.example.com/accept-invite?token=abc',
      companyName: 'North Star',
      role: 'admin',
      markId: 'product',
    });

    expect(initials.html).toContain('NS');
    expect(initials.html).not.toContain('<svg');
    expect(initials.text).not.toContain('Company login id');
  });
});
