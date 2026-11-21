------------------------------ MODULE Sidebar ------------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Threads, FirstThread, SectionIds
VARIABLE s

ThreadOrder == <<FirstThread, CHOOSE t \in Threads: t # FirstThread>>
None == "none"
Active == "active"
Pinned == "pinned"
Working == "working"
Snoozed == "snoozed"
Settled == "settled"
Shelves == {Working, Snoozed, Settled}

PinLabel == "pinned-header"
Divider == "pinned-divider"
ActiveSlot == "active-placeholder"
SettledSlot == "settled-placeholder"
PinHeader == "fork-pinned-header"
ActiveHeader == "fork-active-header"
Header(id) == "fork-section:" \o id
EmptyHint(id) == "fork-section-empty:" \o id
ShelfHeader(group) == group \o "-header"
ForkMarkers == {PinHeader, ActiveHeader} \cup {Header(id) : id \in SectionIds}
                                          \cup {EmptyHint(id) : id \in SectionIds}
ShelfMarkers == {ShelfHeader(g) : g \in Shelves}

Positions(seq) == 1..Len(seq)
Items(seq) == {seq[i] : i \in Positions(seq)}
Count(seq, x) == Cardinality({i \in Positions(seq): seq[i] = x})
Index(seq, x) == CHOOSE i \in Positions(seq): seq[i] = x
OnlyThreads(seq) == SelectSeq(seq, LAMBDA item: item \in Threads)
Exclude(seq, x) == SelectSeq(seq, LAMBDA item: item # x)
Prefix(seq, end) == SubSeq(seq, 1, end)
MoveItem(seq, from, to) ==
  LET rest == SubSeq(seq, 1, from - 1) \o SubSeq(seq, from + 1, Len(seq))
  IN SubSeq(rest, 1, to - 1) \o <<seq[from]>> \o SubSeq(rest, to, Len(rest))

\* sectionsStore.ts:55-112, sections.logic.ts:48-98.
Group(t) == IF s.member[t] \in Items(s.sections) THEN s.member[t] ELSE Active
Rows(group) == SelectSeq(ThreadOrder, LAMBDA t: s.status[t] = group)
Visible(rows, group) ==
  IF group \in s.collapsed THEN SelectSeq(rows, LAMBDA t: t = s.route) ELSE rows
PinnedItems ==
  IF Len(Rows(Pinned)) = 0 THEN <<>> ELSE <<PinHeader>> \o Visible(Rows(Pinned), Pinned)
SectionItems(id) ==
  LET members == SelectSeq(Rows(Active), LAMBDA t: Group(t) = id)
  IN <<Header(id)>>
     \o (IF Len(members) = 0 /\ id \notin s.collapsed THEN <<EmptyHint(id)>> ELSE <<>>)
     \o Visible(members, id)
ActiveItems ==
  IF Len(s.sections) = 0 THEN Rows(Active)
  ELSE <<ActiveHeader>> \o Visible(SelectSeq(Rows(Active), LAMBDA t: Group(t) = Active), Active)
       \o SectionItems(s.sections[1])
       \o (IF Len(s.sections) = 2 THEN SectionItems(s.sections[2]) ELSE <<>>)

OptionalShelf(group) ==
  IF Len(Rows(group)) = 0 THEN <<>> ELSE <<ShelfHeader(group)>> \o Visible(Rows(group), group)
List ==
  <<PinLabel>> \o PinnedItems \o <<Divider, ActiveSlot>> \o ActiveItems
  \o OptionalShelf(Working) \o OptionalShelf(Snoozed)
  \o <<ShelfHeader(Settled), SettledSlot>> \o Visible(Rows(Settled), Settled)

\* Sidebar.logic.ts:232-278, sections.logic.ts:110-151.
LastMatching(seq, labels) ==
  LET matching == {i \in Positions(seq): seq[i] \in labels}
  IN IF matching = {} THEN None
     ELSE seq[CHOOSE i \in matching: \A j \in matching: i >= j]
Boundary(seq) == LastMatching(seq, ShelfMarkers \cup {Divider})
Target(moved, at) ==
  LET header == Boundary(Prefix(moved, at - 1))
  IN CASE header = None -> Pinned
       [] header = Divider -> Active
       [] header = ShelfHeader(Settled) -> Settled
       [] OTHER -> None
RECURSIVE ScanFork(_, _, _, _)
ScanFork(seq, at, inActive, group) ==
  IF at > Len(seq) THEN IF inActive THEN group ELSE None
  ELSE LET item == seq[at]
           sectionHeaders == {Header(id) : id \in SectionIds}
           active == IF item = Divider THEN TRUE ELSE IF item \in ShelfMarkers THEN FALSE ELSE inActive
           nextGroup == IF item = ActiveHeader THEN Active
                        ELSE IF item \in sectionHeaders THEN CHOOSE id \in SectionIds: Header(id) = item
                        ELSE group
       IN ScanFork(seq, at + 1, active, nextGroup)
ForkAt(moved, at) ==
  IF Items(moved) \cap ForkMarkers = {} THEN None
  ELSE ScanFork(Prefix(moved, at - 1), 1, FALSE, Active)

ActiveRegion(seq) ==
  LET start == Index(seq, Divider) + 1
      ends == {i \in start..Len(seq): seq[i] \in ShelfMarkers}
      end == CHOOSE i \in ends: \A j \in ends: i <= j
  IN SubSeq(seq, start, end - 1)
DropPlan(t, target, moved) ==
  CASE target = None \/ s.status[t] = Working -> None
    [] target = Settled -> IF s.status[t] = Settled THEN None ELSE Settled
    [] target = Pinned -> IF s.status[t] = Pinned /\ OnlyThreads(Prefix(moved, Index(moved, Divider) - 1))
                                               = Rows(Pinned) THEN None ELSE Pinned
    [] OTHER -> IF s.status[t] = Active /\ OnlyThreads(ActiveRegion(moved)) = Rows(Active)
                THEN None ELSE Active
Admitted(t, target, fork, plan) ==
  target # None /\ (plan # None \/ (fork # None /\ fork # Group(t)))

\* Sidebar.drag.ts:112-196, sections.logic.ts:158-207. Each key stands for its projected row.
Project(moved, t, target, items) ==
  LET base == IF target = Active THEN moved ELSE Exclude(items, t)
      pinned == OnlyThreads(Prefix(moved, Index(moved, Divider) - 1))
      region == Exclude(ActiveRegion(base), ActiveSlot)
      hasFork == Items(items) \cap ForkMarkers # {}
      settled == IF target = Settled THEN Append(Rows(Settled), t) ELSE Exclude(Rows(Settled), t)
      settledRows == Visible(settled, Settled)
      work == IF ShelfHeader(Working) \in Items(items)
              THEN <<ShelfHeader(Working)>> \o Exclude(Visible(Rows(Working), Working), t) ELSE <<>>
      snooze == IF Items(Rows(Snoozed)) \ {t} # {}
                THEN <<ShelfHeader(Snoozed)>> \o Exclude(Visible(Rows(Snoozed), Snoozed), t) ELSE <<>>
  IN <<PinLabel>>
     \o (IF PinHeader \in Items(items) THEN <<PinHeader>> ELSE <<>>)
     \o pinned \o <<Divider>>
     \o (IF Items(region) \cap (Threads \cup ForkMarkers) = {}
         THEN <<ActiveSlot>> ELSE <<>>)
     \o (IF hasFork THEN region ELSE OnlyThreads(region))
     \o work \o snooze \o <<ShelfHeader(Settled)>>
     \o (IF Len(settledRows) = 0 THEN <<SettledSlot>> ELSE settledRows)

ASSUME Cardinality(Threads) = 2

Init ==
  s = [sections |-> <<>>, member |-> [t \in Threads |-> Active], collapsed |-> Shelves,
       route |-> ThreadOrder[1], status |-> [t \in Threads |-> Active]]

Assign(t, group) == s' = [s EXCEPT !.member[t] = group]
Create(id, selected) ==
  s' = [s EXCEPT !.sections = Append(@, id),
                 !.member = [t \in Threads |-> IF t = selected THEN id ELSE s.member[t]]]
Delete(id) ==
  s' = [s EXCEPT !.sections = Exclude(@, id), !.collapsed = @ \ {id},
                 !.member = [t \in Threads |-> IF s.member[t] = id THEN Active ELSE s.member[t]]]
Toggle(group) ==
  s' = [s EXCEPT !.collapsed = IF group \in @ THEN @ \ {group} ELSE @ \cup {group}]
ToggleAll(collapse) ==
  LET groups == Items(s.sections) \cup {Active, Pinned}
  IN s' = [s EXCEPT !.collapsed = IF collapse THEN @ \cup groups ELSE @ \ groups]

\* Direct pin/settle/snooze and their reversals leave saved membership alone.
Lifecycle(t, dest) ==
  s' = [s EXCEPT !.status[t] = dest]

Drop ==
  LET items == List
  IN \E t \in Items(items) \cap Threads:
     \E over \in Positions(items) \ {Index(items, t)}:
       LET moved == MoveItem(items, Index(items, t), over)
           target == Target(moved, over)
           fork == ForkAt(moved, over)
           plan == DropPlan(t, target, moved)
       IN /\ Admitted(t, target, fork, plan)
          \* Membership is assigned before a no-op or a failed thread operation is known.
          /\ \E committed \in BOOLEAN:
             s' = [s EXCEPT !.member[t] = IF fork = None THEN @ ELSE fork,
                            !.status[t] = IF committed /\ plan # None THEN plan ELSE @]

Next ==
  \/ \E id \in SectionIds \ Items(s.sections), selected \in Threads \cup {None}: Create(id, selected)
  \/ \E id \in Items(s.sections): Delete(id)
  \/ \E t \in Threads, group \in Items(s.sections) \cup {Active}: Assign(t, group)
  \/ Len(s.sections) = 2 /\ s' = [s EXCEPT !.sections = <<s.sections[2], s.sections[1]>>]
  \/ \E group \in Items(s.sections) \cup {Pinned} \cup Shelves
                     \cup (IF Len(s.sections) = 0 THEN {} ELSE {Active}): Toggle(group)
  \/ \E collapse \in BOOLEAN: ToggleAll(collapse)
  \/ \E t \in Threads \cup {None}: s' = [s EXCEPT !.route = t]
  \/ \E t \in Threads, dest \in {Active, Pinned} \cup Shelves: Lifecycle(t, dest)
  \/ Drop

ActiveOnce ==
  \A t \in Items(Rows(Active)):
    Count(List, t) = IF Len(s.sections) > 0 /\ Group(t) \in s.collapsed /\ t # s.route THEN 0 ELSE 1
NoNonActiveInSections ==
  \A t \in Threads: t \in Items(ActiveItems) => s.status[t] = Active
LiveMembership == \A t \in Threads: s.member[t] \in Items(s.sections) \cup {Active}
VisibleLiveSection ==
  \A t \in Items(ActiveItems) \cap Threads:
    LET marker == LastMatching(Prefix(ActiveItems, Index(ActiveItems, t) - 1),
                               {ActiveHeader} \cup {Header(id) : id \in SectionIds})
    IN IF Group(t) = Active THEN marker \in {None, ActiveHeader} ELSE marker = Header(Group(t))
UniqueList == Len(List) = Cardinality(Items(List))

DropAgreement ==
  LET items == List
  IN Items(items) \cap ForkMarkers # {} =>
    \A t \in Items(items) \cap Threads:
    \A over \in Positions(items):
      LET moved == MoveItem(items, Index(items, t), over)
          fork == ForkAt(moved, over)
      IN /\ (fork # None) = (Target(moved, over) = Active)
         /\ fork \in Items(s.sections) \cup {Active, None}

ProjectionChecks(ok(_, _, _)) ==
  LET items == List
  IN \A t \in Items(items) \cap Threads:
     \A over \in Positions(items) \ {Index(items, t)}:
       LET moved == MoveItem(items, Index(items, t), over)
           target == Target(moved, over)
           fork == ForkAt(moved, over)
           plan == DropPlan(t, target, moved)
       IN Admitted(t, target, fork, plan) => ok(Project(moved, t, target, items), t, target)

\* Preview placeholders represent empty regions. The dragged thread can move
\* into a collapsed shelf, and an empty snoozed shelf can disappear.
ProjectionInventory ==
  ProjectionChecks(LAMBDA projected, t, target:
    LET active == ActiveRegion(projected)
        settled == SubSeq(projected, Index(projected, ShelfHeader(Settled)) + 1, Len(projected))
    IN /\ Count(active, ActiveSlot) = IF Items(active) \cap (Threads \cup ForkMarkers) = {} THEN 1 ELSE 0
       /\ Count(settled, SettledSlot) = IF Len(OnlyThreads(settled)) = 0 THEN 1 ELSE 0)

ProjectionKeepsRealRows ==
  ProjectionChecks(LAMBDA projected, t, target:
    /\ Len(projected) = Cardinality(Items(projected))
    /\ \A row \in (Items(List) \cap Threads) \ {t}: Count(projected, row) = 1
    /\ Count(projected, t) = IF target = Settled /\ Settled \in s.collapsed /\ s.route # t THEN 0 ELSE 1
    /\ \A marker \in Items(List) \cap ForkMarkers: Count(projected, marker) = 1)
NoBlankActiveSpacer ==
  ProjectionChecks(LAMBDA projected, t, target:
    ActiveSlot \in Items(projected) =>
      Len(Rows(Active)) = 0 \/ (s.status[t] = Active /\ Len(Rows(Active)) = 1 /\ target # Active))
=============================================================================
