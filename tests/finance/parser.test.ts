import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectStatus, parseNotificationBody, parseSmsBody } from '../../lib/autofetch/parser';
import { identifySmsSender } from '../../lib/autofetch/senders';

/**
 * Sanitized parser fixtures — formats taken from real message shapes with
 * names/numbers fictionalized. No real private banking messages.
 */
const T0 = new Date('2026-10-15T12:00:00').getTime();

function sms(sender: string, body: string) {
  const rule = identifySmsSender(sender);
  assert.ok(rule, `sender ${sender} should be recognized`);
  return parseSmsBody(rule, body, T0);
}

describe('parser fixtures', () => {
  it('Faysal DigiBank QR notification (the v1.1.3 case)', () => {
    const p = parseNotificationBody(
      'Faysal Bank',
      'Faysal DigiBank',
      'Your QR transaction from *8588 in FBL to HASSAN TUC SHOP on 06-OCT-2026 08:49 PM of PKR 76.00 has been successful. Ref 366002',
      T0,
    );
    assert.ok(p);
    assert.equal(p!.direction, 'out');
    assert.equal(p!.amount, 76);
    assert.equal(p!.counterparty, 'HASSAN TUC SHOP');
    assert.equal(p!.tid, '366002');
    assert.equal(p!.status, 'completed');
    assert.equal(p!.accountHint, 'acct8588');
    assert.equal(p!.category, 'shopping');
  });

  it('JazzCash received SMS with TID', () => {
    const p = sms('8558', 'Rs 30.00 received in your JazzCash Mobile Account:03283637461 via Raast. TID: 725981397486');
    assert.ok(p);
    assert.equal(p!.direction, 'in');
    assert.equal(p!.amount, 30);
    assert.equal(p!.tid, '725981397486');
    assert.equal(p!.status, 'completed');
  });

  it('JazzCash paid SMS extracts the merchant', () => {
    const p = sms(
      '8558',
      'Rs 285.00 paid to GRAY MACKENZIE RESTURANTS INTERNATIONAL LIMITED on 04-10-2026 at 09:15 PM. TID: 555',
    );
    assert.ok(p);
    assert.equal(p!.direction, 'out');
    assert.equal(p!.amount, 285);
    assert.match(p!.counterparty, /GRAY MACKENZIE/);
    assert.equal(p!.category, 'food');
  });

  it('a FAILED payment still parses — but is flagged failed, never completed', () => {
    const p = sms(
      '8558',
      'Rs 285.00 paid to GRAY MACKENZIE RESTURANTS INTERNATIONAL LIMITED on 04-10-2026 at 09:15 PM. Transaction failed due to insufficient balance.',
    );
    assert.ok(p);
    assert.equal(p!.status, 'failed');
  });

  it('a PENDING transfer is flagged pending', () => {
    const p = sms('8558', 'Rs 1,000.00 sent to MUHAMMAD ALI - 0345 from your JazzCash Account. Status: Pending');
    assert.ok(p);
    assert.equal(p!.status, 'pending');
  });

  it('OTPs and balance alerts are rejected outright', () => {
    assert.equal(sms('8558', 'Your JazzCash OTP is 482910. Do not share it with anyone.'), null);
    assert.equal(sms('8558', 'Your available balance is Rs 12,450.00 in JazzCash account.'), null);
    assert.equal(parseNotificationBody('SadaPay', 'Promo', 'Get 50% off on your next transfer! Download the app now.', T0), null);
  });

  it('generic notification spend parses with a category suggestion', () => {
    const p = parseNotificationBody('SadaPay', 'Payment', 'Rs 285.00 spent at Gray Mackenzie', T0);
    assert.ok(p);
    assert.equal(p!.direction, 'out');
    assert.equal(p!.category, 'food');
    assert.equal(p!.status, 'completed');
  });

  it('detectStatus is conservative: success wording alone stays completed', () => {
    assert.equal(detectStatus('Payment of Rs 300.00 successful at STORE'), 'completed');
    assert.equal(detectStatus('Your transfer was unsuccessful. Please try again.'), 'failed');
    assert.equal(detectStatus('Transfer is being processing now'), 'pending');
  });
});
