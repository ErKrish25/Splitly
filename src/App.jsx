import { useMemo, useState, useEffect } from "react";
import { Routes, Route, NavLink, useNavigate, useLocation } from "react-router-dom";

const STORAGE_KEY = "spliwise:data:v1";
const APP_CURRENCY = "INR";

const seedData = {
  currentGroupId: null,
  groups: [],
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

const computeBalances = (group) => {
  const balances = Object.fromEntries(
    group.members.map((member) => [member.id, 0])
  );

  group.expenses.forEach((expense) => {
    balances[expense.paidBy] += expense.amountCents;
    Object.entries(expense.splits).forEach(([memberId, share]) => {
      balances[memberId] -= share;
    });
  });

  return balances;
};

const computeSettlements = (balances) => {
  const creditors = [];
  const debtors = [];

  Object.entries(balances).forEach(([memberId, balance]) => {
    if (balance > 0) creditors.push({ memberId, balance });
    if (balance < 0) debtors.push({ memberId, balance });
  });

  const settlements = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(creditor.balance, -debtor.balance);

    settlements.push({
      from: debtor.memberId,
      to: creditor.memberId,
      amountCents: amount,
    });

    debtor.balance += amount;
    creditor.balance -= amount;

    if (debtor.balance === 0) i += 1;
    if (creditor.balance === 0) j += 1;
  }

  return settlements;
};

const parseMembers = (input) =>
  input
    .split(",")
    .map((member) => member.trim())
    .filter(Boolean);

export default function App() {
  const [data, setData] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : seedData;
  });

  const navigate = useNavigate();
  const location = useLocation();

  const [groupForm, setGroupForm] = useState({
    name: "",
    members: "",
  });

  const [groupEditForm, setGroupEditForm] = useState({
    name: "",
    members: "",
  });

  const [expenseForm, setExpenseForm] = useState({
    description: "",
    amount: "",
    paidBy: "",
    participants: [],
    splitType: "even",
    customSplits: {},
  });

  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [expenseError, setExpenseError] = useState("");
  const [groupEditError, setGroupEditError] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const currentGroup = useMemo(() => {
    return data.groups.find((group) => group.id === data.currentGroupId) || null;
  }, [data]);

  useEffect(() => {
    if (!currentGroup) return;
    setGroupEditForm({
      name: currentGroup.name,
      members: currentGroup.members.map((member) => member.name).join(", "),
    });
  }, [currentGroup]);

  const balances = useMemo(() => {
    if (!currentGroup) return null;
    return computeBalances(currentGroup);
  }, [currentGroup]);

  const settlements = useMemo(() => {
    if (!balances) return [];
    return computeSettlements(balances);
  }, [balances]);

  const handleAddGroup = (event) => {
    event.preventDefault();
    const name = groupForm.name.trim();
    const members = parseMembers(groupForm.members).map((member) => ({
      id: uid(),
      name: member,
    }));

    if (!name || members.length === 0) return;

    const newGroup = {
      id: uid(),
      name,
      members,
      currency: APP_CURRENCY,
      expenses: [],
    };

    setData((prev) => ({
      ...prev,
      currentGroupId: newGroup.id,
      groups: [...prev.groups, newGroup],
    }));

    setGroupForm({ name: "", members: "" });
  };

  const handleSelectGroup = (groupId) => {
    setData((prev) => ({
      ...prev,
      currentGroupId: groupId,
    }));
    setEditingExpenseId(null);
    setExpenseError("");
    setGroupEditError("");
  };

  const handleAddExpense = (event) => {
    event.preventDefault();
    if (!currentGroup) return;

    const amountCents = toCents(expenseForm.amount);
    const description = expenseForm.description.trim();
    const paidBy = expenseForm.paidBy || currentGroup.members[0]?.id;
    const participants =
      expenseForm.participants.length > 0
        ? expenseForm.participants
        : currentGroup.members.map((member) => member.id);

    if (!description || amountCents <= 0 || !paidBy) return;

    let splits = {};

    if (expenseForm.splitType === "custom") {
      const customEntries = currentGroup.members.map((member) => [
        member.id,
        toCents(expenseForm.customSplits[member.id] || 0),
      ]);
      const sum = customEntries.reduce((total, [, cents]) => total + cents, 0);
      if (sum !== amountCents) {
        setExpenseError(
          "Custom splits must add up exactly to the total amount."
        );
        return;
      }
      splits = normalizeSplits(
        amountCents,
        currentGroup.members.map((member) => member.id),
        Object.fromEntries(customEntries)
      );
    } else {
      splits = splitEvenly(amountCents, participants);
    }

    const expense = {
      id: editingExpenseId || uid(),
      description,
      amountCents,
      paidBy,
      splitType: expenseForm.splitType,
      splits,
      createdAt: editingExpenseId
        ? currentGroup.expenses.find((item) => item.id === editingExpenseId)
            ?.createdAt || Date.now()
        : Date.now(),
    };

    setData((prev) => ({
      ...prev,
      groups: prev.groups.map((group) => {
        if (group.id !== currentGroup.id) return group;
        const nextExpenses = editingExpenseId
          ? group.expenses.map((item) =>
              item.id === editingExpenseId ? expense : item
            )
          : [expense, ...group.expenses];
        return { ...group, expenses: nextExpenses };
      }),
    }));

    setEditingExpenseId(null);
    setExpenseError("");
    setExpenseForm({
      description: "",
      amount: "",
      paidBy: paidBy,
      participants: [],
      splitType: "even",
      customSplits: {},
    });
  };

  const handleToggleParticipant = (memberId) => {
    setExpenseForm((prev) => {
      const exists = prev.participants.includes(memberId);
      const next = exists
        ? prev.participants.filter((id) => id !== memberId)
        : [...prev.participants, memberId];
      return { ...prev, participants: next };
    });
  };

  const handleEditExpense = (expense) => {
    setEditingExpenseId(expense.id);
    setExpenseError("");
    setExpenseForm({
      description: expense.description,
      amount: (expense.amountCents / 100).toFixed(2),
      paidBy: expense.paidBy,
      participants: Object.keys(expense.splits || {}),
      splitType: expense.splitType || "even",
      customSplits: Object.fromEntries(
        Object.entries(expense.splits || {}).map(([memberId, cents]) => [
          memberId,
          (cents / 100).toFixed(2),
        ])
      ),
    });
    if (location.pathname !== "/expenses") {
      navigate("/expenses");
    }
  };

  const handleDeleteExpense = (expenseId) => {
    if (!currentGroup) return;
    setData((prev) => ({
      ...prev,
      groups: prev.groups.map((group) => {
        if (group.id !== currentGroup.id) return group;
        return {
          ...group,
          expenses: group.expenses.filter((expense) => expense.id !== expenseId),
        };
      }),
    }));
    if (editingExpenseId === expenseId) {
      setEditingExpenseId(null);
      setExpenseError("");
      setExpenseForm({
        description: "",
        amount: "",
        paidBy: currentGroup.members[0]?.id || "",
        participants: [],
        splitType: "even",
        customSplits: {},
      });
    }
  };

  const handleUpdateGroup = (event) => {
    event.preventDefault();
    if (!currentGroup) return;

    const name = groupEditForm.name.trim();
    const memberNames = parseMembers(groupEditForm.members);
    if (!name || memberNames.length === 0) return;

    const removedMembers = currentGroup.members.filter(
      (member) =>
        !memberNames.some(
          (nextName) => nextName.toLowerCase() === member.name.toLowerCase()
        )
    );
    const removedIds = new Set(removedMembers.map((member) => member.id));

    if (removedIds.size > 0) {
      const isReferenced = currentGroup.expenses.some(
        (expense) =>
          removedIds.has(expense.paidBy) ||
          Object.keys(expense.splits || {}).some((id) => removedIds.has(id))
      );
      if (isReferenced) {
        setGroupEditError(
          "Cannot remove members who appear in expense history. Delete or edit those expenses first."
        );
        return;
      }
    }

    const existingByLower = new Map(
      currentGroup.members.map((member) => [member.name.toLowerCase(), member])
    );

    const nextMembers = memberNames.map((memberName) => {
      const existing = existingByLower.get(memberName.toLowerCase());
      return existing
        ? { ...existing, name: memberName }
        : { id: uid(), name: memberName };
    });

    const nextMemberIds = nextMembers.map((member) => member.id);

    const nextExpenses = currentGroup.expenses.map((expense) => {
      const paidBy = nextMemberIds.includes(expense.paidBy)
        ? expense.paidBy
        : nextMemberIds[0];

      const participantIds = Object.keys(expense.splits || {}).filter((id) =>
        nextMemberIds.includes(id)
      );

      const normalizedSplits = normalizeSplits(
        expense.amountCents,
        participantIds.length > 0 ? participantIds : nextMemberIds,
        expense.splits
      );

      return {
        ...expense,
        paidBy,
        splits: normalizedSplits,
      };
    });

    setData((prev) => ({
      ...prev,
      groups: prev.groups.map((group) =>
        group.id === currentGroup.id
          ? {
              ...group,
              name,
              members: nextMembers,
              expenses: nextExpenses,
            }
          : group
      ),
    }));
    setGroupEditError("");
  };

  const handleDeleteGroup = () => {
    if (!currentGroup) return;
    const confirmed = window.confirm(
      `Delete group "${currentGroup.name}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setData((prev) => {
      const remainingGroups = prev.groups.filter(
        (group) => group.id !== currentGroup.id
      );
      return {
        ...prev,
        groups: remainingGroups,
        currentGroupId: remainingGroups[0]?.id || null,
      };
    });
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">S</div>
          <div>
            <h1>Splitly</h1>
            <p>Keep money clean</p>
          </div>
        </div>

        <nav className="nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/expenses">Expenses</NavLink>
        </nav>

        <div className="panel">
          <h2>Groups</h2>
          <div className="group-list">
            {data.groups.length === 0 ? (
              <p className="muted">Create your first group to get started.</p>
            ) : (
              data.groups.map((group) => (
                <button
                  key={group.id}
                  className={`group-item ${
                    currentGroup?.id === group.id ? "active" : ""
                  }`}
                  onClick={() => handleSelectGroup(group.id)}
                >
                  <span>{group.name}</span>
                  <small>{group.members.length} people</small>
                </button>
              ))
            )}
          </div>
        </div>

        <form className="panel" onSubmit={handleAddGroup}>
          <h2>New group</h2>
          <label>
            Group name
            <input
              type="text"
              value={groupForm.name}
              onChange={(event) =>
                setGroupForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Weekend getaway"
            />
          </label>
          <label>
            Members (comma separated)
            <input
              type="text"
              value={groupForm.members}
              onChange={(event) =>
                setGroupForm((prev) => ({
                  ...prev,
                  members: event.target.value,
                }))
              }
              placeholder="Ava, Leo, Nia"
            />
          </label>
          <button className="primary" type="submit">
            Create group
          </button>
        </form>
      </aside>

      <main className="content">
        {!currentGroup ? (
          <section className="empty">
            <h2>Make sharing effortless.</h2>
            <p>
              Build a group on the left, then add expenses to see balances and
              settle up in seconds.
            </p>
          </section>
        ) : (
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <header className="header">
                    <div>
                      <p className="eyebrow">Group</p>
                      <h2>{currentGroup.name}</h2>
                      <p className="muted">
                        {currentGroup.members
                          .map((member) => member.name)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="summary">
                      <div>
                        <p className="muted">Total spent</p>
                        <strong>
                          {formatMoney(
                            currentGroup.expenses.reduce(
                              (sum, expense) => sum + expense.amountCents,
                              0
                            )
                          )}
                        </strong>
                      </div>
                      <div>
                        <p className="muted">Expenses</p>
                        <strong>{currentGroup.expenses.length}</strong>
                      </div>
                    </div>
                  </header>

                  <section className="grid">
                    <div className="card">
                      <h3>Balances</h3>
                      {!balances ? (
                        <p className="muted">Add an expense to see balances.</p>
                      ) : (
                        <ul className="list">
                          {currentGroup.members.map((member) => {
                            const balance = balances[member.id] || 0;
                            return (
                              <li key={member.id}>
                                <span>{member.name}</span>
                                <strong
                                  className={
                                    balance > 0
                                      ? "positive"
                                      : balance < 0
                                      ? "negative"
                                      : "neutral"
                                  }
                                >
                                  {formatMoney(balance)}
                                </strong>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    <div className="card">
                      <h3>Settle up</h3>
                      {settlements.length === 0 ? (
                        <p className="muted">Everyone is even for now.</p>
                      ) : (
                        <ul className="list">
                          {settlements.map((settlement, index) => {
                            const from = currentGroup.members.find(
                              (member) => member.id === settlement.from
                            );
                            const to = currentGroup.members.find(
                              (member) => member.id === settlement.to
                            );
                            return (
                              <li key={`${settlement.from}-${index}`}>
                                <span>
                                  {from?.name} pays {to?.name}
                                </span>
                                <strong>
                                  {formatMoney(settlement.amountCents)}
                                </strong>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    <form className="card" onSubmit={handleUpdateGroup}>
                      <div className="card-header">
                        <h3>Group settings</h3>
                        <button
                          className="ghost danger"
                          type="button"
                          onClick={handleDeleteGroup}
                        >
                          Delete
                        </button>
                      </div>
                      <label>
                        Group name
                        <input
                          type="text"
                          value={groupEditForm.name}
                          onChange={(event) => {
                            setGroupEditError("");
                            setGroupEditForm((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }));
                          }}
                        />
                      </label>
                      <label>
                        Members (comma separated)
                        <input
                          type="text"
                          value={groupEditForm.members}
                          onChange={(event) => {
                            setGroupEditError("");
                            setGroupEditForm((prev) => ({
                              ...prev,
                              members: event.target.value,
                            }));
                          }}
                        />
                      </label>
                      {groupEditError && (
                        <p className="error">{groupEditError}</p>
                      )}
                      <p className="hint">
                        To remove a member, delete or edit expenses that include
                        them first.
                      </p>
                      <button className="primary" type="submit">
                        Save group changes
                      </button>
                    </form>
                  </section>
                </>
              }
            />
            <Route
              path="/expenses"
              element={
                <>
                  <header className="header">
                    <div>
                      <p className="eyebrow">Expenses</p>
                      <h2>Add and manage expenses</h2>
                      <p className="muted">
                        {currentGroup.name} · {currentGroup.members.length}
                      </p>
                    </div>
                  </header>

                  <section className="grid two">
                    <form className="card" onSubmit={handleAddExpense}>
                      <div className="card-header">
                        <h3>
                          {editingExpenseId ? "Edit expense" : "Add expense"}
                        </h3>
                        {editingExpenseId && (
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => {
                              setEditingExpenseId(null);
                              setExpenseError("");
                              setExpenseForm({
                                description: "",
                                amount: "",
                                paidBy: currentGroup.members[0]?.id || "",
                                participants: [],
                                splitType: "even",
                                customSplits: {},
                              });
                            }}
                          >
                            Cancel
                          </button>
                        )}
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
                          placeholder="Dinner at Sora"
                        />
                      </label>
                      <label>
                        Amount
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={expenseForm.amount}
                          onChange={(event) => {
                            setExpenseError("");
                            setExpenseForm((prev) => ({
                              ...prev,
                              amount: event.target.value,
                            }));
                          }}
                          placeholder="120.00"
                        />
                      </label>
                      <label>
                        Paid by
                        <select
                          value={
                            expenseForm.paidBy ||
                            currentGroup.members[0]?.id ||
                            ""
                          }
                          onChange={(event) =>
                            setExpenseForm((prev) => ({
                              ...prev,
                              paidBy: event.target.value,
                            }))
                          }
                        >
                          {currentGroup.members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="split-type">
                        <p>Split type</p>
                        <div className="toggle">
                          <button
                            type="button"
                            className={
                              expenseForm.splitType === "even" ? "active" : ""
                            }
                            onClick={() => {
                              setExpenseError("");
                              setExpenseForm((prev) => ({
                                ...prev,
                                splitType: "even",
                              }));
                            }}
                          >
                            Even
                          </button>
                          <button
                            type="button"
                            className={
                              expenseForm.splitType === "custom" ? "active" : ""
                            }
                            onClick={() => {
                              setExpenseError("");
                              setExpenseForm((prev) => ({
                                ...prev,
                                splitType: "custom",
                              }));
                            }}
                          >
                            Custom
                          </button>
                        </div>
                      </div>

                      {expenseForm.splitType === "even" ? (
                        <div className="split">
                          <p>Split between</p>
                          <div className="pill-grid">
                            {currentGroup.members.map((member) => {
                              const isActive =
                                expenseForm.participants.length === 0 ||
                                expenseForm.participants.includes(member.id);
                              return (
                                <button
                                  key={member.id}
                                  type="button"
                                  className={`pill ${isActive ? "active" : ""}`}
                                  onClick={() =>
                                    handleToggleParticipant(member.id)
                                  }
                                >
                                  {member.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="split custom">
                          <p>Custom amounts</p>
                          <div className="custom-grid">
                            {currentGroup.members.map((member) => (
                              <label key={member.id} className="custom-field">
                                <span>{member.name}</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={
                                    expenseForm.customSplits[member.id] || ""
                                  }
                                  onChange={(event) => {
                                    setExpenseError("");
                                    setExpenseForm((prev) => ({
                                      ...prev,
                                      customSplits: {
                                        ...prev.customSplits,
                                        [member.id]: event.target.value,
                                      },
                                    }));
                                  }}
                                  placeholder="0.00"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {expenseError && <p className="error">{expenseError}</p>}

                      <button className="primary" type="submit">
                        {editingExpenseId ? "Save changes" : "Add expense"}
                      </button>
                    </form>

                    <section className="card ledger">
                      <div className="card-header">
                        <h3>Recent activity</h3>
                      </div>
                      {currentGroup.expenses.length === 0 ? (
                        <p className="muted">
                          No expenses yet. Add your first one.
                        </p>
                      ) : (
                        <ul className="list">
                          {currentGroup.expenses.map((expense) => {
                            const payer = currentGroup.members.find(
                              (member) => member.id === expense.paidBy
                            );
                            return (
                              <li key={expense.id}>
                                <div>
                                  <span>{expense.description}</span>
                                  <small>
                                    Paid by {payer?.name} ·{" "}
                                    {new Date(
                                      expense.createdAt
                                    ).toLocaleDateString("en-IN", {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </small>
                                </div>
                                <div className="actions">
                                  <strong>
                                    {formatMoney(expense.amountCents)}
                                  </strong>
                                  <div className="action-buttons">
                                    <button
                                      className="ghost"
                                      type="button"
                                      onClick={() =>
                                        handleEditExpense(expense)
                                      }
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="ghost danger"
                                      type="button"
                                      onClick={() =>
                                        handleDeleteExpense(expense.id)
                                      }
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  </section>
                </>
              }
            />
          </Routes>
        )}
      </main>
    </div>
  );
}
