/**
 * Person statement export (Phase 5.4).
 *
 * Pure formatter: takes the repository's structured statement data and
 * produces a human-readable text statement plus CSV. Sharing/saving the
 * result is a user-initiated UI action — nothing is sent automatically.
 */
import { formatMinor } from './money';

export interface StatementLoanInput {
  direction: 'lent' | 'borrowed';
  principalMinor: number;
  repaidMinor: number;
  remainingMinor: number;
  status: string;
  localDate: string;
  dueDate: string | null;
  note: string | null;
}

export interface StatementInput {
  personName: string;
  loans: StatementLoanInput[];
  totalLentMinor: number;
  totalBorrowedMinor: number;
  totalRepaidMinor: number;
  remainingReceivableMinor: number;
  remainingPayableMinor: number;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Amount in rupees with exactly two decimals, for CSV consumers. */
function rupees2(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function buildPersonStatementCsv(input: StatementInput): string {
  const lines: string[] = [];
  lines.push(['Person', csvCell(input.personName)].join(','));
  lines.push(['Total lent (PKR)', rupees2(input.totalLentMinor)].join(','));
  lines.push(['Total borrowed (PKR)', rupees2(input.totalBorrowedMinor)].join(','));
  lines.push(['Total repaid (PKR)', rupees2(input.totalRepaidMinor)].join(','));
  lines.push(['Remaining receivable (PKR)', rupees2(input.remainingReceivableMinor)].join(','));
  lines.push(['Remaining payable (PKR)', rupees2(input.remainingPayableMinor)].join(','));
  lines.push('');
  lines.push(['Date', 'Direction', 'Principal (PKR)', 'Repaid (PKR)', 'Remaining (PKR)', 'Status', 'Due date', 'Note'].join(','));
  for (const loan of input.loans) {
    lines.push(
      [
        loan.localDate,
        loan.direction,
        rupees2(loan.principalMinor),
        rupees2(loan.repaidMinor),
        rupees2(loan.remainingMinor),
        loan.status,
        loan.dueDate ?? '',
        csvCell(loan.note ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

export function buildPersonStatementText(input: StatementInput, generatedOn: string): string {
  const lines: string[] = [];
  lines.push(`PocketHisaab — Udhaar statement`);
  lines.push(`Person: ${input.personName}`);
  lines.push(`Generated: ${generatedOn}`);
  lines.push('');
  lines.push(`Total lent: ${formatMinor(input.totalLentMinor)}`);
  lines.push(`Total borrowed: ${formatMinor(input.totalBorrowedMinor)}`);
  lines.push(`Total repaid: ${formatMinor(input.totalRepaidMinor)}`);
  lines.push(`They still owe you: ${formatMinor(input.remainingReceivableMinor)}`);
  lines.push(`You still owe them: ${formatMinor(input.remainingPayableMinor)}`);
  lines.push('');
  if (input.loans.length === 0) {
    lines.push('No udhaar records.');
  } else {
    lines.push('Loans:');
    for (const loan of input.loans) {
      const dir = loan.direction === 'lent' ? 'You lent' : 'You borrowed';
      lines.push(
        `- ${loan.localDate} · ${dir} ${formatMinor(loan.principalMinor)} · repaid ${formatMinor(loan.repaidMinor)} · remaining ${formatMinor(loan.remainingMinor)} · ${loan.status}${loan.dueDate ? ` · due ${loan.dueDate}` : ''}${loan.note ? ` · ${loan.note}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}
