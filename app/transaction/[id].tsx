import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from '../../components/theme';
import { Card, Chip, DangerButton, Field, GhostButton, PrimaryButton } from '../../components/ui';
import {
  CLASSIFICATION_LABEL,
  WalletChips,
  dateInputOf,
  isValidDateInput,
  msOfDateInput,
  parseAmountInput,
  parseSignedAmountInput,
} from '../../components/finance';
import { getLedger } from '../../lib/finance/appLedger';
import { formatMinor } from '../../lib/finance/money';
import type { Category, Transaction, Wallet } from '../../lib/finance/types';
import type { TransactionPostingView } from '../../lib/finance/repository';

const SIMPLE = ['income', 'expense', 'fee', 'refund_received', 'refund_issued', 'opening_balance', 'balance_adjustment', 'transfer'];
const SIGNED = ['opening_balance', 'balance_adjustment'];

export default function TransactionDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const ledger = getLedger();

  const [txnId, setTxnId] = useState<string | null>(null);
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [postings, setPostings] = useState<TransactionPostingView[]>([]);
  const [wallets, setWallets] = useState<(Wallet & { balanceMinor: number })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [reference, setReference] = useState('');
  const [walletId, setWalletId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!rawId) return;
    let id = rawId;
    if (/^\d+$/.test(rawId)) {
      const resolved = await ledger.refForLegacyId('transaction', Number(rawId));
      if (resolved) id = resolved;
    }
    setTxnId(id);
    const [t, p, w, cats] = await Promise.all([
      ledger.getTransaction(id),
      ledger.getTransactionPostings(id),
      ledger.listWallets({ includeArchived: true }),
      ledger.listCategories({ includeArchived: true }),
    ]);
    setTxn(t);
    setPostings(p);
    setWallets(w);
    setCategories(cats);
    if (t) {
      const walletPosting = p.find((x) => x.accountKind === 'wallet');
      const signed = SIGNED.includes(t.classification) && walletPosting ? walletPosting.amountMinor : t.amountMinor;
      setAmount((signed / 100).toString());
      setDate(dateInputOf(t.occurredAt));
      setNote(t.note ?? '');
      setCounterparty(t.counterparty ?? '');
      setReference(t.reference ?? '');
      setWalletId(walletPosting?.walletId ?? null);
      setCategoryId(t.categoryId);
    }
  }, [rawId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!txn) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={{ padding: 24 }}>
          <Text style={s.h2}>Transaction not found</Text>
          <Text style={s.sub}>It may have been removed from the ledger history view.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isSimple = SIMPLE.includes(txn.classification) && !txn.loanId;
  const isReversed = txn.status === 'reversed';
  const isSigned = SIGNED.includes(txn.classification);
  const walletPosting = postings.find((p) => p.accountKind === 'wallet');
  const categoryKind = txn.classification === 'income' ? 'income' : 'expense';
  const visibleCategories = categories.filter((c) => c.kind === categoryKind || c.kind === 'both');

  const save = async () => {
    if (!txnId) return;
    if (!isValidDateInput(date)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD with a real calendar date.');
    const parsed = isSigned ? parseSignedAmountInput(amount) : parseAmountInput(amount);
    if ('error' in parsed) return Alert.alert('Invalid amount', parsed.error);
    setBusy(true);
    try {
      const amountChanged = isSigned
        ? parsed.minor !== (walletPosting?.amountMinor ?? 0)
        : parsed.minor !== txn.amountMinor;
      const dateChanged = msOfDateInput(date) !== txn.occurredAt;
      const walletChanged = walletId !== (walletPosting?.walletId ?? null);
      const metadata = {
        note: note.trim() || null,
        counterparty: counterparty.trim() || null,
        reference: reference.trim() || null,
        categoryId,
      };
      if (amountChanged || dateChanged || walletChanged) {
        const result = await ledger.editSimpleTransaction(txnId, {
          ...(isSigned ? { signedAmountMinor: parsed.minor } : { amountMinor: parsed.minor }),
          occurredAt: msOfDateInput(date),
          ...(txn.classification === 'transfer' ? {} : { walletId: walletId ?? undefined }),
          ...metadata,
        });
        router.replace({ pathname: '/transaction/[id]', params: { id: result.transaction.id } });
      } else {
        await ledger.updateTransactionMetadata(txnId, metadata);
        load();
      }
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = () => {
    Alert.alert('Delete this entry?', `${formatMinor(txn.amountMinor)} will be reversed and all balances updated. You can restore it from here afterwards.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await ledger.reverseTransaction(txnId as string, { note: 'Deleted' });
            load();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  const doDuplicate = async () => {
    try {
      const copy = await ledger.duplicateTransaction(txnId as string);
      router.replace({ pathname: '/transaction/[id]', params: { id: copy.transaction.id } });
    } catch (e) {
      Alert.alert('Could not duplicate', e instanceof Error ? e.message : String(e));
    }
  };

  const doRestore = async () => {
    try {
      const restored = await ledger.restoreTransaction(txnId as string);
      router.replace({ pathname: '/transaction/[id]', params: { id: restored.transaction.id } });
    } catch (e) {
      Alert.alert('Could not restore', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: CLASSIFICATION_LABEL[txn.classification] }} />
      <ScrollView contentContainerStyle={s.scroll}>
        <Card>
          <Text style={{ fontSize: 13, fontWeight: '800', color: C.inkSoft, textTransform: 'uppercase', letterSpacing: 1.2 }}>
            {CLASSIFICATION_LABEL[txn.classification]}
            {isReversed ? ' · reversed' : ''}
            {txn.origin === 'auto' ? ' · ⚡ auto-imported' : ''}
          </Text>
          <Text style={{ fontSize: 32, fontWeight: '900', color: C.ink, marginTop: 8, fontVariant: ['tabular-nums'] }}>
            {formatMinor(txn.amountMinor)}
          </Text>
          <Text style={{ color: C.inkSoft, marginTop: 6, fontSize: 13.5 }}>
            {txn.localDate}
            {postings.map((p) => (p.walletName ? ` · ${p.walletName} ${p.amountMinor >= 0 ? '+' : '−'}${formatMinor(Math.abs(p.amountMinor))}` : '')).join('')}
          </Text>
          {txn.loanId && (
            <View style={{ marginTop: 14 }}>
              <GhostButton title="Open the loan →" onPress={() => router.push({ pathname: '/loan/[id]', params: { id: txn.loanId as string } })} />
              <Text style={{ color: C.inkSoft, fontSize: 12.5, marginTop: 8 }}>
                Loan-linked entries are edited from the loan screen so repayments stay consistent.
              </Text>
            </View>
          )}
        </Card>

        {!isReversed && isSimple && (
          <Card style={{ marginTop: 14 }}>
            <Text style={s.h2}>Edit</Text>
            <View style={{ height: 12 }} />
            <Field label={isSigned ? 'Amount (Rs, may be negative)' : 'Amount (Rs)'} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
            {txn.classification !== 'transfer' && (
              <WalletChips wallets={wallets.filter((w) => !w.archived)} value={walletId} onChange={setWalletId} />
            )}
            {(txn.classification === 'income' || txn.classification === 'expense' || txn.classification === 'fee') && (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: C.inkSoft, marginBottom: 7 }}>Category</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {visibleCategories.map((c) => (
                    <Chip key={c.id} label={c.name} emoji={c.icon ?? undefined} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
                  ))}
                  <Chip label="None" selected={categoryId === null} onPress={() => setCategoryId(null)} />
                </View>
              </View>
            )}
            <Field label="Counterparty" value={counterparty} onChangeText={setCounterparty} placeholder="Who was this with?" />
            <Field label="Reference" value={reference} onChangeText={setReference} placeholder="Bank / wallet reference (optional)" />
            <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional note" />
            <PrimaryButton title={busy ? 'Saving…' : 'Save changes'} onPress={save} disabled={busy} />
          </Card>
        )}

        {!isReversed && !isSimple && !txn.loanId && (
          <Card style={{ marginTop: 14 }}>
            <Text style={s.h2}>Edit details</Text>
            <View style={{ height: 12 }} />
            <Field label="Counterparty" value={counterparty} onChangeText={setCounterparty} />
            <Field label="Reference" value={reference} onChangeText={setReference} />
            <Field label="Note" value={note} onChangeText={setNote} />
            <PrimaryButton
              title="Save details"
              onPress={async () => {
                try {
                  await ledger.updateTransactionMetadata(txnId as string, {
                    note: note.trim() || null,
                    counterparty: counterparty.trim() || null,
                    reference: reference.trim() || null,
                  });
                  load();
                } catch (e) {
                  Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
                }
              }}
            />
          </Card>
        )}

        <View style={{ marginTop: 16, gap: 10 }}>
          {!isReversed && isSimple && <GhostButton title="Duplicate entry" onPress={doDuplicate} />}
          {!isReversed && <DangerButton title="Delete (reverse) entry" onPress={doDelete} />}
          {isReversed && !txn.loanId && <PrimaryButton title="Restore entry" onPress={doRestore} />}
          {isReversed && txn.loanId && (
            <GhostButton title="Restore from the loan screen →" onPress={() => router.push({ pathname: '/loan/[id]', params: { id: txn.loanId as string } })} />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
