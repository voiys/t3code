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
\* Literal strings: tla-ts drops to one worker when the search orders strings it built with \o.
Header(id) == CASE id = "one" -> "fork-section:one" [] id = "two" -> "fork-section:two"
                [] id = "three" -> "fork-section:three"
EmptyHint(id) == CASE id = "one" -> "fork-section-empty:one" [] id = "two" -> "fork-section-empty:two"
                   [] id = "three" -> "fork-section-empty:three"
ShelfHeader(group) == CASE group = "working" -> "working-header" [] group = "snoozed" -> "snoozed-header"
                       [] group = "settled" -> "settled-header"
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
\* A section toggled off in the filter takes its threads out of every list, like the project filter.
Hidden(t) == Group(t) \in s.hidden
VisibleSections == SelectSeq(s.sections, LAMBDA id: id \notin s.hidden)
Rows(group) == SelectSeq(ThreadOrder, LAMBDA t: s.status[t] = group /\ ~Hidden(t))
Visible(rows, group) ==
  IF group \in s.collapsed THEN SelectSeq(rows, LAMBDA t: t = s.route) ELSE rows
PinnedItems ==
  IF Len(Rows(Pinned)) = 0 THEN <<>> ELSE <<PinHeader>> \o Visible(Rows(Pinned), Pinned)
SectionItems(id) ==
  LET members == SelectSeq(Rows(Active), LAMBDA t: Group(t) = id)
  IN <<Header(id)>>
     \o (IF Len(members) = 0 /\ id \notin s.collapsed THEN <<EmptyHint(id)>> ELSE <<>>)
     \o Visible(members, id)
RECURSIVE SectionsItems(_)
SectionsItems(ids) == IF ids = <<>> THEN <<>> ELSE SectionItems(Head(ids)) \o SectionsItems(Tail(ids))
\* Named sections in their saved order, then Active (the threads in no section) below them.
ActiveItems ==
  IF Len(VisibleSections) = 0 THEN Rows(Active)
  ELSE SectionsItems(VisibleSections)
       \o <<ActiveHeader>> \o Visible(SelectSeq(Rows(Active), LAMBDA t: Group(t) = Active), Active)

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
Unset == "unset"
SectionHeaders == {Header(id) : id \in SectionIds}
HeaderGroup(item) ==
  IF item = ActiveHeader THEN Active ELSE CHOOSE id \in SectionIds: Header(id) = item
\* The first group header after the drop slot, within the active region.
RECURSIVE NextGroup(_, _)
NextGroup(seq, at) ==
  IF at > Len(seq) \/ seq[at] \in ShelfMarkers THEN Active
  ELSE IF seq[at] \in SectionHeaders \cup {ActiveHeader} THEN HeaderGroup(seq[at])
  ELSE NextGroup(seq, at + 1)
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
  ELSE LET above == ScanFork(Prefix(moved, at - 1), 1, FALSE, Unset)
       IN IF above = Unset THEN NextGroup(moved, at + 1) ELSE above

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
ASSUME SectionIds \subseteq {"one", "two", "three"}

Init ==
  s = [sections |-> <<>>, member |-> [t \in Threads |-> Active], collapsed |-> Shelves,
       route |-> ThreadOrder[1], status |-> [t \in Threads |-> Active],
       hidden |-> {}, focus |-> None]

\* `focus` is the thread a user action last touched; other steps clear it.
Assign(t, group) == s' = [s EXCEPT !.member[t] = group, !.focus = t]
Create(id, selected) ==
  s' = [s EXCEPT !.sections = Append(@, id),
                 !.member = [t \in Threads |-> IF t = selected THEN id ELSE s.member[t]],
                 !.focus = selected]
Delete(id) ==
  s' = [s EXCEPT !.sections = Exclude(@, id), !.collapsed = @ \ {id}, !.hidden = @ \ {id},
                 !.member = [t \in Threads |-> IF s.member[t] = id THEN Active ELSE s.member[t]],
                 !.focus = None]
\* The filter's section list: drag a section to any slot, or toggle it off and on.
Reorder(id, to) ==
  s' = [s EXCEPT !.sections = MoveItem(@, Index(@, id), to), !.focus = None]
\* Dragging a shown section's header in the sidebar: the line drawn before shown block `b`
\* (Len + 1 = above Active) is where it goes. Hidden sections keep their places around it.
Insert(seq, at, x) == SubSeq(seq, 1, at - 1) \o <<x>> \o SubSeq(seq, at, Len(seq))
HeaderTarget(from, b) == IF b > from THEN b - 1 ELSE b
ReorderShown(id, to) ==
  LET vis == VisibleSections
      newVis == MoveItem(vis, Index(vis, id), to)
      rest == Exclude(s.sections, id)
  IN IF to < Len(newVis) THEN Insert(rest, Index(rest, newVis[to + 1]), id)
     ELSE Insert(rest, Index(rest, newVis[to - 1]) + 1, id)
HeaderDrop(id, b) ==
  s' = [s EXCEPT !.sections = ReorderShown(id, HeaderTarget(Index(VisibleSections, id), b)),
                 !.focus = None]
ToggleHidden(id) ==
  s' = [s EXCEPT !.hidden = IF id \in @ THEN @ \ {id} ELSE @ \cup {id}, !.focus = None]
Toggle(group) ==
  s' = [s EXCEPT !.collapsed = IF group \in @ THEN @ \ {group} ELSE @ \cup {group}, !.focus = None]
ToggleAll(collapse) ==
  LET groups == Items(s.sections) \cup {Active, Pinned}
  IN s' = [s EXCEPT !.collapsed = IF collapse THEN @ \cup groups ELSE @ \ groups, !.focus = None]

\* Direct pin/settle/snooze and their reversals leave saved membership alone.
Lifecycle(t, dest, byUser) ==
  s' = [s EXCEPT !.status[t] = dest, !.focus = IF byUser THEN t ELSE None]

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
                            !.status[t] = IF committed /\ plan # None THEN plan ELSE @,
                            !.focus = t]

\* Row menus and drags act on rendered rows only; "Move to section" offers the shown sections.
Rendered == Items(List) \cap Threads
Next ==
  \/ \E id \in SectionIds \ Items(s.sections), selected \in Rendered \cup {None}: Create(id, selected)
  \/ \E id \in Items(s.sections): Delete(id)
  \/ \E t \in Rendered, group \in Items(VisibleSections) \cup {Active}: Assign(t, group)
  \/ \E id \in Items(s.sections), to \in Positions(s.sections): Reorder(id, to)
  \/ \E id \in Items(s.sections): ToggleHidden(id)
  \/ Len(VisibleSections) >= 2 /\
     \E id \in Items(VisibleSections), b \in 1..(Len(VisibleSections) + 1): HeaderDrop(id, b)
  \/ \E group \in Items(VisibleSections) \cup {Pinned} \cup Shelves
                     \cup (IF Len(VisibleSections) = 0 THEN {} ELSE {Active}): Toggle(group)
  \/ \E collapse \in BOOLEAN: ToggleAll(collapse)
  \/ \E t \in Threads \cup {None}: s' = [s EXCEPT !.route = t, !.focus = None]
  \/ \E t \in Rendered, dest \in {Active, Pinned} \cup Shelves: Lifecycle(t, dest, TRUE)
  \* Background moves (working, snooze wakes, other devices) touch any thread.
  \/ \E t \in Threads, dest \in {Active, Pinned} \cup Shelves: Lifecycle(t, dest, FALSE)
  \/ Drop

ActiveOnce ==
  \A t \in Items(Rows(Active)):
    Count(List, t) = IF Len(VisibleSections) > 0 /\ Group(t) \in s.collapsed /\ t # s.route THEN 0 ELSE 1
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
         /\ fork \in Items(VisibleSections) \cup {Active, None}

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
\* Filtered sections leave no header, empty hint or row behind; shown ones keep one header each.
HiddenGone ==
  /\ \A t \in Threads: Hidden(t) => Count(List, t) = 0
  /\ \A id \in s.hidden: Header(id) \notin Items(List) /\ EmptyHint(id) \notin Items(List)
  /\ \A id \in Items(VisibleSections): Count(List, Header(id)) = 1
HiddenLive == s.hidden \subseteq Items(s.sections)
\* Pinned, then the shown sections in saved order, then Active, then the shelves.
GroupOrder ==
  LET headers == SelectSeq(List, LAMBDA item: item \in SectionHeaders \cup {ActiveHeader, PinHeader})
      expected == [i \in 1..Len(VisibleSections) |-> Header(VisibleSections[i])]
  IN headers = (IF PinHeader \in Items(List) THEN <<PinHeader>> ELSE <<>>)
               \o (IF Len(VisibleSections) = 0 THEN <<>> ELSE expected \o <<ActiveHeader>>)
     /\ \A h \in Items(headers):
          /\ h # PinHeader => Index(List, h) > Index(List, Divider)
          /\ Index(List, h) < Index(List, ShelfHeader(Settled))
\* A header dropped at a line lands there among the shown sections, and moves nothing else.
HeaderDropMatchesLine ==
  LET vis == VisibleSections
  IN Len(vis) >= 2 =>
     \A id \in Items(vis), b \in 1..(Len(vis) + 1):
       LET result == ReorderShown(id, HeaderTarget(Index(vis, id), b))
           rest == Exclude(vis, id)
           expected == IF b > Len(vis) THEN Append(rest, id)
                       ELSE IF vis[b] = id THEN vis
                       ELSE Insert(rest, Index(rest, vis[b]), id)
       IN /\ SelectSeq(result, LAMBDA x: x \notin s.hidden) = expected
          /\ Len(result) = Len(s.sections) /\ Items(result) = Items(s.sections)
          /\ SelectSeq(result, LAMBDA x: x \in s.hidden) = SelectSeq(s.sections, LAMBDA x: x \in s.hidden)
\* Nothing a user does to a thread files it out of sight.
ActedUnfiltered == s.focus # None => ~Hidden(s.focus)

\* The preview shows a dropped row in the group it then lands in: the header above it, or below
\* it when it sits above every header.
GroupInPreview(projected, t) ==
  LET region == ActiveRegion(projected)
      at == Index(region, t)
      above == LastMatching(Prefix(region, at - 1), SectionHeaders \cup {ActiveHeader})
  IN IF above # None THEN HeaderGroup(above) ELSE NextGroup(region, at + 1)
DropMatchesPreview ==
  LET items == List
  IN \A t \in Items(items) \cap Threads:
     \A over \in Positions(items) \ {Index(items, t)}:
       LET moved == MoveItem(items, Index(items, t), over)
           target == Target(moved, over)
           fork == ForkAt(moved, over)
           plan == DropPlan(t, target, moved)
       IN (Admitted(t, target, fork, plan) /\ target = Active /\ fork # None)
          => GroupInPreview(Project(moved, t, target, items), t) = fork
=============================================================================
