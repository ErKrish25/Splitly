import { useMemo, useState, useEffect } from "react";

const STORAGE_KEY = "splitly:data:v2";
const APP_CURRENCY = "INR";
const YOU_ID = "you";

const seedData = {
  friends: [],
  expenses: [],
};

const uid = () => Math.random().toString(36).slice(2, 10);

const toCents = (value) => {
  const normalized = Number.parseFloat(value);
  if (Number.isNaN(normalized)) return 0;
  return Math.round(normalized * 100);
};

const formatMoney = (cents) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: APP_CURRENCY,
    minimumFractionDigits: 2,
  }).format(cents / 100);

const splitEvenly = (amountCents, participantIds) => {
  if (participantIds.length === 0) return {};
  const base = Math.floor(amountCents / participantIds.length);
  let remainder = amountCents % participantIds.length;
  const splits = {};
  participantIds.forEach((memberId) => {
    splits[memberId] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  });
  return splits;
};

const normalizeSplits = (amountCents, participantIds, splits = {}) => {
  if (participantIds.length === 0) return {};
  const next = {};
  participantIds.forEach((memberId) => {
    next[memberId] = splits[memberId] ?? 0;
  });
  let sum = Object.values(next).reduce((total, value) => total + value, 0);
  let diff = amountCents - sum;
  let index = 0;
  while (diff !== 0) {
    const memberId = participantIds[index % participantIds.length];
    next[memberId] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
    index += 1;
  }
  return next;
};

const parseNames = (input) =>
  input
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

const normalizeData = (raw) => {
  if (!raw) return seedData;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return {
    ...seedData,
    ...parsed,
    friends: Array.isArray(parsed.friends) ? parsed.friends : [],
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
  };
};

export default function App() {
  const [data, setData] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return normalizeData(stored);
  });

  const [selectedFriendId, setSelectedFriendId] = useState(null);
  const [showExpenseForm, setShowExpenseForm] = useState(false);

  const [expenseForm, setExpenseForm] = useState({
    description: "",
    amount: "",
    paidBy: YOU_ID,
    friendNames: "",
    participants: [YOU_ID],
    splitType: "even",
    customSplits: {},
  });
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [expenseError, setExpenseError] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const friendsById = useMemo(() => {
    const map = new Map(data.friends.map((friend) => [friend.id, friend]));
    return map;
  }, [data.friends]);

  const friendBalances = useMemo(() => {
    const balances = Object.fromEntries(
      data.friends.map((friend) => [friend.id, 0])
    );

    data.expenses.forEach((expense) => {
      const splits = expense.splits || {};
      data.friends.forEach((friend) => {
        const friendId = friend.id;
        if (!expense.participants.includes(friendId) && expense.paidBy !== friendId) {
          return;
        }
        if (expense.paidBy === YOU_ID) {
          balances[friendId] += splits[friendId] || 0;
        } else if (expense.paidBy === friendId) {
          balances[friendId] -= splits[YOU_ID] || 0;
        }
      });
    });

    return balances;
  }, [data.expenses, data.friends]);

  const selectedFriend = selectedFriendId
    ? friendsById.get(selectedFriendId)
    : null;

  const selectedFriendExpenses = useMemo(() => {
    if (!selectedFriendId) return [];
    return data.expenses.filter((expense) =>
      expense.participants.includes(selectedFriendId) ||
      expense.paidBy === selectedFriendId
    );
  }, [data.expenses, selectedFriendId]);

  const handleAddExpense = (event) => {
    event.preventDefault();
    const description = expenseForm.description.trim();
    const amountCents = toCents(expenseForm.amount);
    const friendNames = parseNames(expenseForm.friendNames);

    if (!description || amountCents <= 0 || friendNames.length === 0) return;

    const existingByLower = new Map(
      data.friends.map((friend) => [friend.name.toLowerCase(), friend])
    );
    const nextFriends = [...data.friends];
    const participantIds = [YOU_ID];

    friendNames.forEach((name) => {
      const existing = existingByLower.get(name.toLowerCase());
      if (existing) {
        participantIds.push(existing.id);
      } else {
        const newFriend = { id: uid(), name };
        nextFriends.push(newFriend);
        participantIds.push(newFriend.id);
      }
    });

    const uniqueParticipants = Array.from(new Set(participantIds));

    let splits = {};
    if (expenseForm.splitType === "custom") {
      const customEntries = uniqueParticipants.map((memberId) => [
        memberId,
        toCents(expenseForm.customSplits[memberId] || 0),
      ]);
      const sum = customEntries.reduce((total, [, cents]) => total + cents, 0);
      if (sum !== amountCents) {
        setExpenseError("Custom splits must add up exactly to the total amount.");
        return;
      }
      splits = normalizeSplits(
        amountCents,
        uniqueParticipants,
        Object.fromEntries(customEntries)
      );
    } else {
      splits = splitEvenly(amountCents, uniqueParticipants);
    }

    const paidBy = expenseForm.paidBy;

    const expense = {
      id: editingExpenseId || uid(),
      description,
      amountCents,
      paidBy,
      participants: uniqueParticipants,
      splitType: expenseForm.splitType,
      splits,
      createdAt: editingExpenseId
        ? data.expenses.find((item) => item.id === editingExpenseId)?.createdAt ||
          Date.now()
        : Date.now(),
    };

    setData((prev) => ({
      ...prev,
      friends: nextFriends,
      expenses: editingExpenseId
        ? prev.expenses.map((item) => (item.id === editingExpenseId ? expense : item))
        : [expense, ...prev.expenses],
    }));

    setEditingExpenseId(null);
    setExpenseError("");
    setExpenseForm({
      description: "",
      amount: "",
      paidBy: YOU_ID,
      friendNames: "",
      participants: [YOU_ID],
      splitType: "even",
      customSplits: {},
    });
    setShowExpenseForm(false);
  };

  const handleEditExpense = (expense) => {
    setEditingExpenseId(expense.id);
    setExpenseError("");
    const friendNames = expense.participants
      .filter((id) => id !== YOU_ID)
      .map((id) => friendsById.get(id)?.name)
      .filter(Boolean)
      .join(", ");

    setExpenseForm({
      description: expense.description,
      amount: (expense.amountCents / 100).toFixed(2),
      paidBy: expense.paidBy,
      friendNames,
      participants: expense.participants,
      splitType: expense.splitType || "even",
      customSplits: Object.fromEntries(
        Object.entries(expense.splits || {}).map(([memberId, cents]) => [
          memberId,
          (cents / 100).toFixed(2),
        ])
      ),
    });
    setShowExpenseForm(true);
  };

  const handleDeleteExpense = (expenseId) => {
    setData((prev) => ({
      ...prev,
      expenses: prev.expenses.filter((expense) => expense.id !== expenseId),
    }));
    if (editingExpenseId === expenseId) {
      setEditingExpenseId(null);
      setExpenseError("");
      setExpenseForm({
        description: "",
        amount: "",
        paidBy: YOU_ID,
        friendNames: "",
        participants: [YOU_ID],
        splitType: "even",
        customSplits: {},
      });
    }
  };

  const handleParticipantToggle = (memberId) => {
    if (memberId === YOU_ID) return;
    setExpenseForm((prev) => {
      const exists = prev.participants.includes(memberId);
      const next = exists
        ? prev.participants.filter((id) => id !== memberId)
        : [...prev.participants, memberId];
      return { ...prev, participants: next };
    });
  };

  const renderFriendAmount = (friendId) => {
    const balance = friendBalances[friendId] || 0;
    if (balance === 0) return "Settled";
    if (balance > 0) return `Owes you ${formatMoney(balance)}`;
    return `You owe ${formatMoney(Math.abs(balance))}`;
  };

  const renderExpenseLine = (expense, friendId) => {
    const friendShare = expense.splits?.[friendId] || 0;
    const yourShare = expense.splits?.[YOU_ID] || 0;
    if (expense.paidBy === YOU_ID) {
      return `Paid by you · ${formatMoney(friendShare)} owed`;
    }
    if (expense.paidBy === friendId) {
      return `Paid by ${selectedFriend?.name || "friend"} · you owe ${formatMoney(
        yourShare
      )}`;
    }
    return "Shared expense";
  };

  return (
    <div className="app">
      <header className="topbar">
        {selectedFriend ? (
          <button className="back" onClick={() => setSelectedFriendId(null)}>
            Back
          </button>
        ) : null}
        <div>
          <h1>Splitly</h1>
          <p>Keep money clean</p>
        </div>
      </header>

      {!selectedFriend ? (
        <main className="content">
          <section className="section">
            <h2>Friends</h2>
            {data.friends.length === 0 ? (
              <p className="muted">Add an expense to create your first friend.</p>
            ) : (
              <div className="friend-list">
                {data.friends.map((friend) => (
                  <button
                    key={friend.id}
                    className="friend-card"
                    onClick={() => setSelectedFriendId(friend.id)}
                  >
                    <div>
                      <h3>{friend.name}</h3>
                      <p className="muted">{renderFriendAmount(friend.id)}</p>
                    </div>
                    <span className="chevron">›</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="content">
          <section className="section">
            <div className="friend-header">
              <div>
                <p className="eyebrow">Friend</p>
                <h2>{selectedFriend.name}</h2>
                <p className="muted">{renderFriendAmount(selectedFriend.id)}</p>
              </div>
            </div>
            {selectedFriendExpenses.length === 0 ? (
              <p className="muted">No expenses yet with this friend.</p>
            ) : (
              <ul className="expense-list">
                {selectedFriendExpenses.map((expense) => (
                  <li key={expense.id} className="expense-item">
                    <div>
                      <h4>{expense.description}</h4>
                      <p className="muted">
                        {new Date(expense.createdAt).toLocaleDateString("en-IN", {
                          month: "short",
                          day: "numeric",
                        })}
                        {" · "}
                        {renderExpenseLine(expense, selectedFriend.id)}
                      </p>
                    </div>
                    <div className="expense-actions">
                      <strong>{formatMoney(expense.amountCents)}</strong>
                      <div className="action-buttons">
                        <button
                          className="ghost"
                          type="button"
                          onClick={() => handleEditExpense(expense)}
                        >
                          Edit
                        </button>
                        <button
                          className="ghost danger"
                          type="button"
                          onClick={() => handleDeleteExpense(expense.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      )}

      <button className="fab" onClick={() => setShowExpenseForm(true)}>
        + Add expense
      </button>

      {showExpenseForm && (
        <div className="sheet">
          <form className="sheet-card" onSubmit={handleAddExpense}>
            <div className="sheet-header">
              <h3>{editingExpenseId ? "Edit expense" : "Add expense"}</h3>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setShowExpenseForm(false);
                  setEditingExpenseId(null);
                  setExpenseError("");
                }}
              >
                Close
              </button>
            </div>

            <label>
              Description
              <input
                type="text"
                value={expenseForm.description}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Dinner"
              />
            </label>
            <label>
              Amount
              <input
                type="number"
                min="0"
                step="0.01"
                value={expenseForm.amount}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    amount: event.target.value,
                  }))
                }
                placeholder="120.00"
              />
            </label>
            <label>
              Friends (comma separated)
              <input
                type="text"
                value={expenseForm.friendNames}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    friendNames: event.target.value,
                  }))
                }
                placeholder="Ava, Leo"
              />
            </label>
            <label>
              Paid by
              <select
                value={expenseForm.paidBy}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    paidBy: event.target.value,
                  }))
                }
              >
                <option value={YOU_ID}>You</option>
                {data.friends.map((friend) => (
                  <option key={friend.id} value={friend.id}>
                    {friend.name}
                  </option>
                ))}
              </select>
            </label>

            {expenseForm.friendNames && (
              <div className="split-section">
                <p>Split between</p>
                <div className="pill-grid">
                  <button type="button" className="pill active">
                    You
                  </button>
                  {parseNames(expenseForm.friendNames).map((name) => (
                    <button key={name} type="button" className="pill active">
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="split-type">
              <p>Split type</p>
              <div className="toggle">
                <button
                  type="button"
                  className={expenseForm.splitType === "even" ? "active" : ""}
                  onClick={() => setExpenseForm((prev) => ({ ...prev, splitType: "even" }))}
                >
                  Equal
                </button>
                <button
                  type="button"
                  className={expenseForm.splitType === "custom" ? "active" : ""}
                  onClick={() => setExpenseForm((prev) => ({ ...prev, splitType: "custom" }))}
                >
                  Custom
                </button>
              </div>
            </div>

            {expenseForm.splitType === "custom" && (
              <div className="custom-grid">
                <label className="custom-field">
                  <span>You</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseForm.customSplits[YOU_ID] || ""}
                    onChange={(event) =>
                      setExpenseForm((prev) => ({
                        ...prev,
                        customSplits: {
                          ...prev.customSplits,
                          [YOU_ID]: event.target.value,
                        },
                      }))
                    }
                    placeholder="0.00"
                  />
                </label>
                {parseNames(expenseForm.friendNames).map((name) => {
                  const existing = data.friends.find(
                    (friend) => friend.name.toLowerCase() === name.toLowerCase()
                  );
                  const memberId = existing?.id || name;
                  return (
                    <label key={name} className="custom-field">
                      <span>{name}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={expenseForm.customSplits[memberId] || ""}
                        onChange={(event) =>
                          setExpenseForm((prev) => ({
                            ...prev,
                            customSplits: {
                              ...prev.customSplits,
                              [memberId]: event.target.value,
                            },
                          }))
                        }
                        placeholder="0.00"
                      />
                    </label>
                  );
                })}
              </div>
            )}

            {expenseError && <p className="error">{expenseError}</p>}

            <button className="primary" type="submit">
              {editingExpenseId ? "Save changes" : "Add expense"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
