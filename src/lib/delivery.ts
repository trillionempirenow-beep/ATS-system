import type { DeliveryReport } from '@shared/api/envelope';

/** The sentence appended to a success message about the email that went with it. */
export function deliveryNote(report: DeliveryReport, who = 'The candidate'): string {
  switch (report.email) {
    case 'sent': return ` ${who} was emailed.`;
    case 'duplicate': return ` ${who} already had this email.`;
    case 'failed': return ' The email could not be sent. Let them know another way.';
    case 'not_configured': return ' Email is not set up, so no message was sent.';
    default: return '';
  }
}
