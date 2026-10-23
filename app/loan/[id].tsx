import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, DangerButton, Field, GhostButton, HeroCard, PrimaryButton } from '../../components/ui';
import {
  WalletChips,
  dateInputOf,
  isValidDateInput,
  msOfDateInput,
  parseAmountInput,
  todayInput,
} from '../../components/finance';
import { getLedger } from '../../lib/finance/appLedger';
import { formatMinor } from '../../lib/finance/money';
import { buildPersonStatementCsv, buildPersonStatementText } from '../../lib/finance/statement';
import type { Loan, Transaction, Wallet } from '../../lib/finance/types';

interface Detail {
  loan: Loan;
  remainingMinor: number;
  totalRepaidMinor: number;
  repayments: Transaction[];
  overdue: boolean;
  daysOverdue: number;
}

export default function LoanDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const ledger = getLedger();

  const [loanId, setLoanId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [wallets, setWallets] = useState<(Wallet & { balanceMinor: number })[]>([]);

  const [repayAmount, setRepayAmount] = useState('');
  const [repayDate, setRepayDate] = useState(todayInput());
  const [repayWalletId, setRepayWalletId] = useState<string | null>(null);

  const [editingRepayment, setEditingRepayment] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');

  const [principal, setPrincipal] = useState('');
  const [loanDate, setLoanDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loanNote, setLoanNote] = useState('');
  const [loanWalletId, setLoanWalletId] = useState<string | null>(null);
  const [reminder, setReminder] = useState('');

  const load = useCallback(async () => {
    if (!rawId) return;
    let id = rawId;
    if (/^\d+$/.test(rawId)) {
      const resolved = await ledger.refForLegacyId('loan', Number(rawId));
      if (resolved) id = resolved;
    }
    setLoanId(id);
    const [d, w] = await Promise.all([ledger.getLoanDetail(id), ledger.listWallets({ includeArchived: true })]);
    setDetail(d as Detail);
    setWallets(w);
    setRepayWalletId((prev) => prev ?? d.loan.walletId);
    setLoanWalletId(d.loan.walletId);
    setPrincipal((d.loan.principalMinor / 100).toString());
    setLoanDate(dateInputOf(d.loan.occurredAt));
    setDueDate(d.loan.dueDate ?? '');
    setLoanNote(d.loan.note ?? '');
    setReminder(d.loan.reminderDate ?? '');
  }, [rawId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!detail || !loanId) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={{ padding: 24 }}>
          <Text style={s.h2}>Loan not found</Text>
        </View>
      </SafeAreaView>
    );
  }
  const { loan } = detail;
  const progress = loan.principalMinor > 0 ? Math.min(1, detail.totalRepaidMinor / loan.principalMinor) : 0;
  const isVoid = loan.status === 'void';
  const isSettled = detail.remainingMinor === 0 && !isVoid;

  const doRepay = async () => {
    const parsed = parseAmountInput(repayAmount);
    if ('error' in parsed) return Alert.alert('Invalid amount', parsed.error);
    if (!isValidDateInput(repayDate)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD with a real calendar date.');
    try {
      await ledger.recordRepayment({
        loanId,
        walletId: repayWalletId ?? loan.walletId,
        amountMinor: parsed.minor,
        occurredAt: msOfDateInput(repayDate),
      });
      setRepayAmount('');
      load();
    } catch (e) {
      Alert.alert('Could not record repayment', e instanceof Error ? e.message : String(e));
    }
  };

  const saveRepaymentEdit = async () => {
    if (!editingRepayment) return;
    const parsed = parseAmountInput(editAmount);
    if ('error' in parsed) return Alert.alert('Invalid amount', parsed.error);
    if (!isValidDateInput(editDate)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD with a real calendar date.');
    try {
      await ledger.editRepayment(editingRepayment.id, { amountMinor: parsed.minor, occurredAt: msOfDateInput(editDate) });
      setEditingRepayment(null);
      load();
    } catch (e) {
      Alert.alert('Could not edit repayment', e instanceof Error ? e.message : String(e));
    }
  };

  const reverseRepayment = (t: Transaction) => {
    Alert.alert('Reverse this repayment?', `${formatMinor(t.amountMinor)} will be added back to the remaining balance.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reverse',
        style: 'destructive',
        onPress: async () => {
          try {
            await ledger.reverseTransaction(t.id, { note: 'Repayment reversed' });
            load();
          } catch (e) {
            Alert.alert('Could not reverse', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  const saveLoanEdit = async () => {
    const parsed = parseAmountInput(principal);
    if ('error' in parsed) return Alert.alert('Invalid principal', parsed.error);
    if (!isValidDateInput(loanDate)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD with a real calendar date.');
    if (dueDate && !isValidDateInput(dueDate)) return Alert.alert('Invalid due date', 'Use YYYY-MM-DD or leave it empty.');
    try {
      await ledger.updateLoan(loanId, {
        principalMinor: parsed.minor,
        walletId: loanWalletId ?? loan.walletId,
        occurredAt: msOfDateInput(loanDate),
        dueDate: dueDate || null,
        note: loanNote.trim() || null,
      });
      load();
    } catch (e) {
      Alert.alert('Could not save loan', e instanceof Error ? e.message : String(e));
    }
  };

  const doSettle = async () => {
    try {
      await ledger.recordRepayment({ loanId, amountMinor: detail.remainingMinor, note: 'Settled' });
      load();
    } catch (e) {
      Alert.alert('Could not settle', e instanceof Error ? e.message : String(e));
    }
  };

  const doReopen = async () => {
    if (!loan.settlementTransactionId) return;
    try {
      await ledger.reverseTransaction(loan.settlementTransactionId, { note: 'Settlement undone' });
      load();
    } catch (e) {
      Alert.alert('Could not reopen', e instanceof Error ? e.message : String(e));
    }
  };

  const doReminder = async () => {
    if (reminder && !isValidDateInput(reminder)) return Alert.alert('Invalid reminder date', 'Use YYYY-MM-DD or leave it empty to clear.');
    try {
      await ledger.setLoanReminder(loanId, reminder || null);
      load();
    } catch (e) {
      Alert.alert('Could not save reminder', e instanceof Error ? e.message : String(e));
    }
  };

  const shareStatement = async (csv: boolean) => {
    try {
      const data = await ledger.getPersonStatementData(loan.personId);
      const input = {
        personName: data.person.name,
        loans: data.loans.map((d) => ({
          direction: d.loan.direction, principalMinor: d.loan.principalMinor,
          repaidMinor: d.repaidMinor, remainingMinor: d.remainingMinor,
          status: d.loan.status, localDate: d.loan.localDate, dueDate: d.loan.dueDate, note: d.loan.note,
        })),
        totalLentMinor: data.totalLentMinor, totalBorrowedMinor: data.totalBorrowedMinor,
        totalRepaidMinor: data.totalRepaidMinor,
        remainingReceivableMinor: data.remainingReceivableMinor,
        remainingPayableMinor: data.remainingPayableMinor,
      };
      const content = csv ? buildPersonStatementCsv(input) : buildPersonStatementText(input, todayInput());
      await Share.share({ message: content, title: `Udhaar statement — ${data.person.name}` });
    } catch (e) {
      Alert.alert('Could not build statement', e instanceof Error ? e.message : String(e));
    }
  };

  const doDelete = () => {
    Alert.alert(
      'Delete this loan?',
      'The principal and all its repayments will be reversed together and every balance restored. You can restore the loan from here afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete loan',
          style: 'destructive',
          onPress: async () => {
            try {
              await ledger.voidLoan(loanId);
              load();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };

  const doRestore = async () => {
    try {
      await ledger.restoreLoan(loanId);
      load();
    } catch (e) {
      Alert.alert('Could not restore', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: loan.personName }} />
      <ScrollView contentContainerStyle={s.scroll}>
        <HeroCard
          eyebrow={loan.direction === 'lent' ? `${loan.personName} owes you` : `you owe ${loan.personName}`}
          value={formatMinor(detail.remainingMinor)}
          sub={`Principal ${formatMinor(loan.principalMinor)} · repaid ${formatMinor(detail.totalRepaidMinor)} · status ${loan.status.replace('_', ' ')}`}
        />
        {detail.overdue && (
          <Card style={{ marginTop: 12, backgroundColor: C.redSoft, borderColor: C.red }}>
            <Text style={{ fontWeight: '900', color: C.redDark }}>
              ⚠️ Overdue by {detail.daysOverdue} day{detail.daysOverdue === 1 ? '' : 's'} · due {loan.dueDate}
            </Text>
          </Card>
        )}
        {isVoid && (
          <Card style={{ marginTop: 12, backgroundColor: C.amberSoft, borderColor: C.amber }}>
            <Text style={{ fontWeight: '900', color: C.amberDark }}>This loan is deleted (void). Its history is preserved in the ledger.</Text>
            <View style={{ height: 10 }} />
            <PrimaryButton title="Restore loan" onPress={doRestore} />
          </Card>
        )}

        {/* Progress */}
        <Card style={{ marginTop: 14 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ fontWeight: '800', color: C.ink }}>Repaid</Text>
            <Text style={{ fontWeight: '800', color: C.inkSoft }}>{Math.round(progress * 100)}%</Text>
          </View>
          <View style={{ height: 12, borderRadius: 6, backgroundColor: C.line, marginTop: 10, overflow: 'hidden' }}>
            <View style={{ height: 12, width: `${progress * 100}%`, backgroundColor: C.emerald }} />
          </View>
          <Text style={{ color: C.inkSoft, fontSize: 12.5, marginTop: 10 }}>
            {loan.localDate} · wallet {wallets.find((w) => w.id === loan.walletId)?.name ?? '—'}
            {loan.dueDate ? ` · due ${loan.dueDate}` : ''}
            {loan.reminderDate ? ` · reminder ${loan.reminderDate}` : ''}
            {loan.note ? ` · ${loan.note}` : ''}
          </Text>
        </Card>

        {!isVoid && !isSettled && (
          <Card style={{ marginTop: 14 }}>
            <Text style={s.h2}>{loan.direction === 'lent' ? 'Record repayment received' : 'Record repayment made'}</Text>
            <View style={{ height: 12 }} />
            <WalletChips wallets={wallets.filter((w) => !w.archived)} value={repayWalletId} onChange={setRepayWalletId} />
            <Field label={`Amount (Rs) — remaining ${formatMinor(detail.remainingMinor)}`} value={repayAmount} onChangeText={setRepayAmount} keyboardType="decimal-pad" placeholder="Partial amounts are fine" />
            <Field label="Date (YYYY-MM-DD)" value={repayDate} onChangeText={setRepayDate} />
            <PrimaryButton title="Record repayment" onPress={doRepay} />
            <View style={{ height: 10 }} />
            <GhostButton title="Settle in full" onPress={doSettle} />
          </Card>
        )}
        {isSettled && loan.settlementTransactionId && (
          <View style={{ marginTop: 14 }}>
            <GhostButton title="Reopen loan (undo settlement)" onPress={doReopen} />
          </View>
        )}

        <Text style={s.sectionTitle}>Repayment history</Text>
        {detail.repayments.length === 0 ? (
          <Card>
            <Text style={{ color: C.inkSoft }}>No repayments yet. Partial repayments will appear here with their own history.</Text>
          </Card>
        ) : (
          <Card style={{ paddingVertical: 6 }}>
            {detail.repayments.map((t, i) => (
              <View key={t.id} style={[s.row, { paddingVertical: 11, borderBottomWidth: i === detail.repayments.length - 1 ? 0 : 1, borderBottomColor: C.line, opacity: t.status === 'reversed' ? 0.5 : 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '800', color: C.ink }}>
                    {formatMinor(t.amountMinor)}
                    {t.status === 'reversed' ? ' · reversed' : ''}
                  </Text>
                  <Text style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>{t.localDate}{t.note ? ` · ${t.note}` : ''}</Text>
                </View>
                {t.status === 'posted' && !isVoid && (
                  <>
                    <Pressable
                      onPress={() => {
                        setEditingRepayment(t);
                        setEditAmount((t.amountMinor / 100).toString());
                        setEditDate(dateInputOf(t.occurredAt));
                      }}
                      style={{ marginRight: 14 }}
                    >
                      <Text style={{ fontWeight: '800', color: C.emeraldDark }}>Edit</Text>
                    </Pressable>
                    <Pressable onPress={() => reverseRepayment(t)}>
                      <Text style={{ fontWeight: '800', color: C.redDark }}>Reverse</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ))}
          </Card>
        )}

        {editingRepayment && (
          <Card style={{ marginTop: 14 }}>
            <Text style={s.h2}>Edit repayment</Text>
            <View style={{ height: 12 }} />
            <Field label="Amount (Rs)" value={editAmount} onChangeText={setEditAmount} keyboardType="decimal-pad" />
            <Field label="Date (YYYY-MM-DD)" value={editDate} onChangeText={setEditDate} />
            <PrimaryButton title="Save repayment" onPress={saveRepaymentEdit} />
            <View style={{ height: 10 }} />
            <GhostButton title="Cancel" onPress={() => setEditingRepayment(null)} />
          </Card>
        )}

        {!isVoid && (
          <Card style={{ marginTop: 14 }}>
            <Text style={s.h2}>Edit loan</Text>
            <View style={{ height: 12 }} />
            <Field label="Principal (Rs)" value={principal} onChangeText={setPrincipal} keyboardType="decimal-pad" />
            <WalletChips wallets={wallets.filter((w) => !w.archived)} value={loanWalletId} onChange={setLoanWalletId} />
            <Field label="Date (YYYY-MM-DD)" value={loanDate} onChangeText={setLoanDate} />
            <Field label="Due date (YYYY-MM-DD, optional)" value={dueDate} onChangeText={setDueDate} />
            <Field label="Note" value={loanNote} onChangeText={setLoanNote} />
            <PrimaryButton title="Save loan" onPress={saveLoanEdit} />
            <View style={{ height: 14 }} />
            <Field label="Reminder date (YYYY-MM-DD, optional)" value={reminder} onChangeText={setReminder} placeholder="Remind me on…" />
            <GhostButton title="Save reminder" onPress={doReminder} />
          </Card>
        )}

        <Card style={{ marginTop: 14 }}>
          <Text style={s.h2}>Person statement</Text>
          <Text style={s.sub}>A complete statement for {loan.personName} across all their loans. Sharing is always your tap — nothing is sent automatically.</Text>
          <View style={{ height: 12 }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <GhostButton title="Share statement" onPress={() => shareStatement(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <GhostButton title="Share CSV" onPress={() => shareStatement(true)} />
            </View>
          </View>
        </Card>

        {!isVoid && (
          <View style={{ marginTop: 18 }}>
            <DangerButton title="Delete loan" onPress={doDelete} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
