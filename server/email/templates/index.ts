import { renderEmail, type Brand, type RenderedEmail } from './layout.js';

export interface WhenInfo {
  date: string;
  time: string;
  timezone: string;
}

export function interviewInvitation(brand: Brand, v: {
  candidateName: string; jobTitle: string; meetingType: 'screening' | 'interview'; interviewType: string;
  when: WhenInfo; duration: string | null; interviewerName: string | null; joinUrl: string | null;
  location: string | null; roomCode: string | null; builtIn: boolean; statusUrl: string;
}): RenderedEmail {
  const kind = v.meetingType === 'screening' ? 'screening call' : 'interview';
  const rows: Array<[string, string, 'mono'?]> = [
    ['Role', v.jobTitle],
    ['Date', v.when.date],
    ['Time', `${v.when.time} (${v.when.timezone})`],
  ];
  if (v.duration) rows.push(['Duration', v.duration]);
  rows.push(['Format', v.interviewType]);
  if (v.interviewerName) rows.push(['Interviewer', v.interviewerName]);
  if (v.location) rows.push(['Location', v.location]);
  if (v.roomCode) rows.push(['Room code', v.roomCode, 'mono']);

  const instructions = v.builtIn
    ? [
        `The room opens shortly before your start time. Use the button below; no app or account is needed.`,
        'Use Chrome, Edge, Safari or Firefox on a laptop or phone, and allow camera and microphone access.',
        'You will wait in a short waiting room until your interviewer admits you.',
        'This link is personal to you. Please do not forward it.',
      ]
    : v.joinUrl
      ? ['Join using the meeting link below a couple of minutes early.']
      : ['Please arrive a few minutes early.'];

  return renderEmail(brand, `Your ${kind} for ${v.jobTitle} at ${brand.company}`, `${v.when.date} at ${v.when.time} (${v.when.timezone})`, [
    { kind: 'heading', text: `You're scheduled: ${v.jobTitle}` },
    { kind: 'paragraph', text: `Hi ${v.candidateName}, thank you for your interest in ${brand.company}. Here are the details of your ${kind}.` },
    { kind: 'details', rows },
    ...(v.joinUrl ? [{ kind: 'button' as const, label: v.builtIn ? 'Join interview' : 'Open meeting link', href: v.joinUrl }] : []),
    { kind: 'list', title: 'Before you join', items: instructions },
    ...(v.joinUrl ? [{ kind: 'link' as const, label: "If the button doesn't work, copy this link:", href: v.joinUrl }] : []),
    { kind: 'note', text: `You can also find this interview on your application status page: ${v.statusUrl}` },
  ]);
}

export function interviewReminder(brand: Brand, v: {
  candidateName: string; jobTitle: string; when: WhenInfo; joinUrl: string | null; startsIn: string;
}): RenderedEmail {
  return renderEmail(brand, `Reminder: your interview for ${v.jobTitle} starts ${v.startsIn}`, `${v.when.time} (${v.when.timezone})`, [
    { kind: 'heading', text: `Your interview starts ${v.startsIn}` },
    { kind: 'paragraph', text: `Hi ${v.candidateName}, this is a reminder of your interview for ${v.jobTitle}.` },
    { kind: 'details', rows: [['Date', v.when.date], ['Time', `${v.when.time} (${v.when.timezone})`]] },
    ...(v.joinUrl ? [{ kind: 'button' as const, label: 'Join interview', href: v.joinUrl }] : []),
    { kind: 'note', text: 'Find a quiet spot and check your camera and microphone a few minutes before.' },
  ]);
}

export function interviewChanged(brand: Brand, v: {
  candidateName: string; jobTitle: string; change: 'rescheduled' | 'cancelled'; when: WhenInfo | null; joinUrl: string | null;
}): RenderedEmail {
  if (v.change === 'cancelled') {
    return renderEmail(brand, `Your interview for ${v.jobTitle} was cancelled`, 'We will be in touch about next steps.', [
      { kind: 'heading', text: 'Your interview was cancelled' },
      { kind: 'paragraph', text: `Hi ${v.candidateName}, your interview for ${v.jobTitle} has been cancelled. The recruiting team will contact you about next steps.` },
    ]);
  }
  return renderEmail(brand, `New time for your ${v.jobTitle} interview`, v.when ? `${v.when.date} at ${v.when.time}` : '', [
    { kind: 'heading', text: 'Your interview has a new time' },
    { kind: 'paragraph', text: `Hi ${v.candidateName}, your interview for ${v.jobTitle} was rescheduled.` },
    ...(v.when ? [{ kind: 'details' as const, rows: [['Date', v.when.date], ['Time', `${v.when.time} (${v.when.timezone})`]] as Array<[string, string]> }] : []),
    ...(v.joinUrl ? [{ kind: 'button' as const, label: 'Join interview', href: v.joinUrl }] : []),
    { kind: 'note', text: 'Your previous link still works and now points to the new time.' },
  ]);
}

export function applicationReceived(brand: Brand, v: {
  candidateName: string; jobTitle: string; applicationId: number; statusUrl: string;
}): RenderedEmail {
  return renderEmail(brand, `We received your application for ${v.jobTitle}`, `Application #${v.applicationId}`, [
    { kind: 'heading', text: 'Thanks for applying' },
    { kind: 'paragraph', text: `Hi ${v.candidateName}, we received your application for ${v.jobTitle}. Our recruiting team reviews every application, and you can follow its progress at any time.` },
    { kind: 'details', rows: [['Role', v.jobTitle], ['Application ID', String(v.applicationId), 'mono']] },
    { kind: 'button', label: 'Track your application', href: v.statusUrl },
    { kind: 'note', text: 'Keep your application ID. You will need it, together with this email address, to check your status.' },
  ]);
}

export function applicationStatus(brand: Brand, v: {
  candidateName: string; jobTitle: string; stageLabel: string; stage: string; statusUrl: string; feedback: string | null;
}): RenderedEmail {
  const copy: Record<string, { heading: string; body: string }> = {
    screening: { heading: 'Your application is moving forward', body: `Your application for ${v.jobTitle} has moved to screening. We will reach out to schedule a short call.` },
    interview: { heading: 'You have been invited to interview', body: `Your application for ${v.jobTitle} has moved to the interview stage. Watch for an email with your interview time.` },
    offer: { heading: 'Good news about your application', body: `Your application for ${v.jobTitle} has reached the offer stage. The team will contact you with the details.` },
    hired: { heading: `Welcome to ${brand.company}`, body: `Congratulations, you have been hired for ${v.jobTitle}. The People team will be in touch about onboarding.` },
    rejected: { heading: 'An update on your application', body: `Thank you for applying for ${v.jobTitle}. After careful consideration we will not be moving forward with your application at this time.` },
  };
  const c = copy[v.stage] ?? { heading: 'An update on your application', body: `Your application for ${v.jobTitle} is now at: ${v.stageLabel}.` };
  return renderEmail(brand, `${c.heading} — ${v.jobTitle}`, v.stageLabel, [
    { kind: 'heading', text: c.heading },
    { kind: 'paragraph', text: `Hi ${v.candidateName}, ${c.body}` },
    ...(v.feedback ? [{ kind: 'paragraph' as const, text: v.feedback }] : []),
    { kind: 'button', label: 'View application status', href: v.statusUrl },
  ]);
}

export function passwordResetApproved(brand: Brand, v: { name: string; resetUrl: string; hours: number }): RenderedEmail {
  return renderEmail(brand, `Set a new password for ${brand.company} People`, `This link works once and expires in ${v.hours} hours.`, [
    { kind: 'heading', text: 'Your password reset was approved' },
    { kind: 'paragraph', text: `Hi ${v.name}, a Super Admin approved your request. Use the button below to choose a new password.` },
    { kind: 'button', label: 'Set a new password', href: v.resetUrl },
    { kind: 'note', text: `The link works once and expires in ${v.hours} hours. If you did not ask for this, contact your Super Admin.` },
    { kind: 'link', label: "If the button doesn't work, copy this link:", href: v.resetUrl },
  ]);
}

export function passwordResetRejected(brand: Brand, v: { name: string; note: string | null }): RenderedEmail {
  return renderEmail(brand, 'Your password reset request was not approved', 'Your existing password is unchanged.', [
    { kind: 'heading', text: 'Password reset not approved' },
    { kind: 'paragraph', text: `Hi ${v.name}, your password reset request was not approved. Your existing password is unchanged.` },
    ...(v.note ? [{ kind: 'paragraph' as const, text: `Note from the Super Admin: ${v.note}` }] : []),
  ]);
}
