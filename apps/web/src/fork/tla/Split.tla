------------------------------- MODULE Split -------------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Threads, FirstThread, PaneBound
VARIABLE s

Blank == 0
NoFault == "none"
MaxColumns == 4
MaxRows == 2
MaxSlots == MaxRows * MaxColumns
Ids == 1..(PaneBound + 1)

Flat(rows) ==
  IF Len(rows) = 0 THEN <<>>
  ELSE IF Len(rows) = 1 THEN rows[1]
  ELSE rows[1] \o rows[2]
Positions(seq) == 1..Len(seq)
Insert(seq, at, item) ==
  SubSeq(seq, 1, at - 1) \o <<item>> \o SubSeq(seq, at, Len(seq))
Slot(id, ref) == [id |-> id, ref |-> ref]
Keys(rows) == {slot.id : slot \in {Flat(rows)[i] : i \in Positions(Flat(rows))}}
SlotAt(rows, id) ==
  CHOOSE slot \in {Flat(rows)[i] : i \in Positions(Flat(rows))}: slot.id = id
Refs(rows, ref) ==
  {slot.id : slot \in {candidate \in {Flat(rows)[i] : i \in Positions(Flat(rows))}:
                       candidate.ref = ref}}
RefAt(rows, id) == IF id \in Keys(rows) THEN SlotAt(rows, id).ref ELSE Blank
Remove(rows, id) ==
  SelectSeq([r \in Positions(rows) |-> SelectSeq(rows[r], LAMBDA slot: slot.id # id)],
            LAMBDA row: Len(row) > 0)

\* threadSplitStore.ts:75-119. A draft route has no server ref.
Resolve(rows, focus, route) ==
  IF Len(Flat(rows)) < 2 THEN [rows |-> <<>>, focus |-> Blank]
  ELSE LET showing == IF route = Blank THEN {} ELSE Refs(rows, route)
           first == Flat(rows)[1].id
           id == IF showing # {} THEN
                   Flat(rows)[CHOOSE i \in Positions(Flat(rows)):
                     /\ Flat(rows)[i].id \in showing
                     /\ \A j \in 1..(i - 1): Flat(rows)[j].id \notin showing].id
                 ELSE IF focus \in Keys(rows) THEN focus ELSE first
       IN [rows |-> [r \in Positions(rows) |->
                        [i \in Positions(rows[r]) |->
                           IF rows[r][i].id = id THEN Slot(id, route) ELSE rows[r][i]]],
           focus |-> id]
Shown == Resolve(s.rows, s.focus, s.route)
CurrentAt(state) ==
  LET shown == Resolve(state.rows, state.focus, state.route)
  IN IF shown.focus = Blank
     THEN [rows |-> << <<Slot(state.solo, state.route)>> >>, focus |-> state.solo]
     ELSE shown
Current == CurrentAt(s)
GoTo(ref) == IF ref = Blank THEN s.route ELSE ref
Relayout(state, rows, focus) ==
  IF Len(Flat(rows)) < 2
  THEN [state EXCEPT !.rows = <<>>, !.focus = Blank,
                     !.solo = IF rows = <<>> THEN @ ELSE Flat(rows)[1].id]
  ELSE [state EXCEPT !.rows = rows, !.focus = focus]

\* splitLayout.ts:31-105. Coordinates and rectangles reduce to the reachable insertion zones.
Column(row, at) == [kind |-> "column", row |-> row, at |-> at]
NewRow(at) == [kind |-> "row", row |-> at, at |-> 1]
AutoZone == [kind |-> "auto", row |-> 0, at |-> 0]
FullZone == [kind |-> "full", row |-> 0, at |-> 0]
Zones(base) ==
  UNION {{Column(r, i) : i \in 1..(Len(base[r]) + 1)}
          : r \in {r \in Positions(base): Len(base[r]) < MaxColumns}}
  \cup (IF base = <<>> THEN {Column(1, 1)} ELSE {})
  \cup (IF Len(base) < MaxRows THEN {NewRow(1), NewRow(Len(base) + 1)} ELSE {})
Auto(base) ==
  LET room == {r \in Positions(base): Len(base[r]) < MaxColumns}
  IN IF Len(Flat(base)) >= MaxSlots THEN FullZone
     ELSE IF room = {} THEN NewRow(Len(base) + 1)
     ELSE LET r == CHOOSE r \in room: \A j \in room: r <= j
          IN Column(r, Len(base[r]) + 1)
\* Insertion always produces at least one pane. The empty sequence represents null.
Rejected == <<>>
ValidGrid(rows) ==
  /\ Len(rows) \in 1..MaxRows
  /\ Len(Flat(rows)) <= MaxSlots
  /\ \A r \in Positions(rows): Len(rows[r]) \in 1..MaxColumns
Apply(base, item, zone) ==
  LET next ==
    CASE zone.kind = "row" ->
           IF zone.row \in 1..(Len(base) + 1)
           THEN Insert(base, zone.row, <<item>>)
           ELSE Rejected
      [] zone.kind = "column" ->
           IF zone.row \in Positions(base)
           THEN IF zone.at \in 1..(Len(base[zone.row]) + 1)
                THEN [base EXCEPT ![zone.row] = Insert(@, zone.at, item)]
                ELSE Rejected
           ELSE Rejected
      [] OTHER -> Rejected
  IN IF next = Rejected THEN Rejected
     ELSE IF ValidGrid(next) THEN next ELSE Rejected

\* A removed id is recycled only after all live references to it have gone.
Pending(state) == {id \in Ids: state.pending[id] # Blank}
PendingIds == Pending(s)
FreeIds(state, base) == Ids \ (Keys(base) \cup Pending(state))
Fresh(available) == CHOOSE id \in available: \A other \in available: id <= other

Init ==
  s = [rows |-> <<>>, focus |-> Blank, solo |-> 1, route |-> FirstThread,
       latest |-> FirstThread, settled |-> {}, pending |-> [id \in Ids |-> Blank],
       fault |-> NoFault]

Navigate(ref) ==
  /\ ref # s.route
  /\ s' = [s EXCEPT !.route = ref, !.fault = NoFault]

Sync ==
  /\ s.latest # s.route
  /\ s' = [s EXCEPT !.rows = Shown.rows, !.focus = Shown.focus,
                    !.latest = s.route, !.fault = NoFault]

\* OpenResult's route is the ref passed to the next open, or navigated to after the batch.
OpenResult(state, ref, zone) ==
  LET current == CurrentAt(state)
      base == current.rows
      existing == Refs(base, ref)
      refused == [state |-> state, opened |-> Blank]
  IN IF existing # {}
     THEN LET id == CHOOSE id \in existing: TRUE
          IN IF zone = AutoZone
             THEN [state |-> [state EXCEPT !.rows = IF Len(Flat(base)) = 1 THEN <<>> ELSE base,
                                           !.focus = IF Len(Flat(base)) = 1 THEN Blank ELSE id,
                                           !.route = ref, !.fault = NoFault],
                   opened |-> ref]
             ELSE LET rows == Apply(Remove(base, id), SlotAt(base, id), zone)
                  IN IF rows = Rejected THEN refused
                     ELSE [state |-> [Relayout(state, rows, current.focus) EXCEPT
                                        !.route = ref, !.fault = NoFault],
                           opened |-> ref]
     ELSE LET target == IF zone = AutoZone THEN Auto(base) ELSE zone
              available == FreeIds(state, base)
          IN IF Len(Flat(base)) >= PaneBound \/ available = {} THEN refused
             ELSE LET id == Fresh(available)
                      rows == Apply(base, Slot(id, ref), target)
                  IN IF rows = Rejected THEN refused
                     ELSE [state |-> [Relayout(state, rows, id) EXCEPT
                                        !.route = ref, !.fault = NoFault],
                           opened |-> ref]

OpenAt(ref, zone) == s' = OpenResult(s, ref, zone).state

\* SplitDragOverlay.onDrop plans against the grid with the existing slot removed.
SidebarZones(base, ref) ==
  LET existing == Refs(base, ref)
  IN Zones(IF existing = {} THEN base ELSE Remove(base, CHOOSE id \in existing: TRUE))
Open ==
  \E ref \in Threads:
    \/ OpenAt(ref, AutoZone)
    \/ \E zone \in SidebarZones(Current.rows, ref): OpenAt(ref, zone)

Move ==
  LET shown == Resolve(s.rows, s.focus, s.latest)
  IN \E id \in Keys(shown.rows):
    LET base == Remove(shown.rows, id)
    IN \E zone \in Zones(base):
      LET rows == Apply(base, SlotAt(shown.rows, id), zone)
      IN IF rows = Rejected THEN UNCHANGED s
         ELSE s' = [Relayout(s, rows, shown.focus) EXCEPT !.fault = NoFault]

Focus ==
  \E id \in Keys(Shown.rows) \ {Shown.focus}:
    s' = [s EXCEPT !.rows = Shown.rows, !.focus = id,
                   !.route = GoTo(RefAt(Shown.rows, id)), !.fault = NoFault]

Neighbor(rows, id) ==
  LET flat == Flat(rows)
      i == CHOOSE j \in Positions(flat): flat[j].id = id
  IN IF i < Len(flat) THEN flat[i + 1] ELSE flat[i - 1]

CloseResult(resolved, id) ==
  IF id \notin Keys(resolved.rows) THEN [state |-> s, next |-> Blank]
  ELSE LET focused == resolved.focus = id
           neighbor == IF focused THEN Neighbor(resolved.rows, id)
                       ELSE SlotAt(resolved.rows, resolved.focus)
       IN [state |-> Relayout(s, Remove(resolved.rows, id), neighbor.id),
           next |-> IF focused THEN neighbor.ref ELSE Blank]

Closed(resolved, id) ==
  LET result == CloseResult(resolved, id)
  IN [result.state EXCEPT !.route = GoTo(result.next)]

Close ==
  \E id \in Keys(Shown.rows):
    s' = [Closed(Shown, id) EXCEPT !.fault = NoFault]

Distance(i, j) == IF i < j THEN j - i ELSE i - j
ThreadNeighbor(rows, id) ==
  LET flat == Flat(rows)
      at == CHOOSE i \in Positions(flat): flat[i].id = id
      others == {i \in Positions(flat): i # at /\ flat[i].ref # Blank}
  IN IF others = {} THEN Slot(Blank, Blank)
     ELSE flat[CHOOSE i \in others:
                 \A j \in others: \/ Distance(i, at) < Distance(j, at)
                                  \/ Distance(i, at) = Distance(j, at) /\ i <= j]

\* Watcher effect observes an active->settled transition on an already mounted ref.
\* Begin and close are separate to allow route changes during the animation.
Settle(ref) ==
  /\ ref \notin s.settled
  /\ s.latest = s.route
  /\ LET matches == Refs(Shown.rows, ref)
     IN IF matches = {} THEN s' = [s EXCEPT !.settled = @ \cup {ref}, !.fault = NoFault]
        ELSE LET id == CHOOSE id \in matches: TRUE
                 start == IF id \in PendingIds THEN s
                          ELSE IF Shown.focus = id
                               THEN LET neighbor == ThreadNeighbor(Shown.rows, id)
                                    IN IF neighbor.ref = Blank THEN [s EXCEPT !.pending[id] = ref]
                                       ELSE [s EXCEPT !.rows = Shown.rows, !.focus = neighbor.id,
                                                !.route = GoTo(neighbor.ref), !.pending[id] = ref]
                               ELSE [s EXCEPT !.pending[id] = ref]
             IN s' = [start EXCEPT !.settled = @ \cup {ref}, !.fault = NoFault]

Unsettle(ref) ==
  /\ ref \in s.settled
  /\ s' = [s EXCEPT !.settled = @ \ {ref}, !.fault = NoFault]

FinishDissolve ==
  \E id \in PendingIds:
    LET ref == s.pending[id]
        \* The app reads the router's latest location here (liveRouteRef), not the synced route.
        latest == CurrentAt(s)
        matches == RefAt(latest.rows, id) = ref
        resolved == Resolve(s.rows, s.focus, s.route)
        removed == matches /\ id \in Keys(resolved.rows)
        actual == RefAt(Shown.rows, id)
        result == IF matches THEN CloseResult(resolved, id) ELSE [state |-> s, next |-> Blank]
        route == IF result.next # Blank THEN result.next
                 ELSE IF matches /\ s.route = ref THEN Blank ELSE s.route
        stillSolo == /\ result.state.rows = <<>>
                     /\ route = ref
                     /\ ref \in s.settled
                     /\ (id \in Keys(Shown.rows) \/ s.solo = id)
        fault == IF removed /\ id \in Keys(Shown.rows) /\ actual # ref
                 THEN IF actual \in s.settled THEN "otherSettled" ELSE "otherContent"
                 ELSE IF stillSolo THEN "leftSettledSolo" ELSE NoFault
    IN s' = [result.state EXCEPT !.pending[id] = Blank, !.route = route, !.fault = fault]

Next ==
  \/ \E ref \in Threads \cup {Blank}: Navigate(ref)
  \/ Sync
  \/ Open
  \/ Move
  \/ Focus
  \/ Close
  \/ \E ref \in Threads: Settle(ref) \/ Unsettle(ref)
  \/ FinishDissolve

\* The structural pass erases settlement history. Include dismissal's layout
\* edits with the last synced route and its follow-up navigation home.
SafetyNext ==
  \/ \E ref \in Threads \cup {Blank}: Navigate(ref)
  \/ Sync
  \/ Open
  \/ Move
  \/ Focus
  \/ Close
  \/ \E id \in Keys(s.rows):
       LET resolved == Resolve(s.rows, s.focus, s.route)
           result == CloseResult(resolved, id)
       IN s' = [result.state EXCEPT
                  !.route = IF id \in Keys(resolved.rows) /\ result.next = Blank
                               /\ RefAt(resolved.rows, id) = s.route
                            THEN Blank ELSE GoTo(result.next),
                  !.fault = NoFault]

RowBounds == Len(s.rows) <= MaxRows /\ \A r \in Positions(s.rows): Len(s.rows[r]) \in 1..MaxColumns
SlotCap == Len(Flat(s.rows)) <= MaxSlots
UniqueIds == Cardinality(Keys(s.rows)) = Len(Flat(s.rows))
UniqueThreadRefs ==
  \A ref \in Threads: Cardinality(Refs(Shown.rows, ref)) <= 1
FocusedRoute ==
  /\ IF s.rows = <<>> THEN s.focus = Blank ELSE s.focus \in Keys(s.rows)
  /\ Current.focus \in Keys(Current.rows)
  /\ s.route \in Threads => RefAt(Current.rows, Current.focus) = s.route
SingleView == Len(Flat(s.rows)) # 1 /\ (Len(Flat(s.rows)) < 2 => Shown.rows = <<>>)
NoMissingDropRow == s.fault # "missingDropRow"
NoReplacementClose == s.fault \notin {"otherSettled", "otherContent"}
AlreadySettledStays == s.fault # "otherSettled"
NoSettledSoloAfterDissolve == s.fault # "leftSettledSolo"

\* Geometry-only pass at the actual 4x2 limit. Slot payloads are immaterial to applyDrop.
CapacityInit == s = << <<Slot(1, Blank)>> >>
CapacityCandidates ==
  LET flat == Flat(s)
      item == Slot(Len(flat) + 1, Blank)
      dragged ==
        UNION {LET taken == flat[i]
                   base == Remove(s, taken.id)
                IN {base} \cup {Apply(base, taken, zone) : zone \in Zones(base)}
                 : i \in Positions(flat)}
  IN {Apply(s, item, zone) : zone \in Zones(s)}
     \cup (IF Auto(s) = FullZone THEN {s} ELSE {Apply(s, item, Auto(s))})
     \cup (IF Len(flat) >= 2 THEN dragged ELSE {})

\* The capacity model tracks row lengths, normalizing identities after each operation.
Canonical(rows) ==
  [r \in Positions(rows) |-> [i \in Positions(rows[r]) |->
     Slot((IF r = 1 THEN 0 ELSE Len(rows[1])) + i, Blank)]]
CapacityStep ==
  \E rows \in CapacityCandidates: s' = Canonical(rows)

\* Store callers may supply stale or explicit zones, including an insertion
\* into a full grid. CapacityCandidates already includes moves planned after removal.
ExplicitZones ==
  {NewRow(r) : r \in 0..(MaxRows + 2)}
  \cup UNION {{Column(r, i) : i \in 0..(MaxColumns + 2)} : r \in 0..(MaxRows + 1)}
AppliedOrSame(base, item, zone) ==
  LET rows == Apply(base, item, zone)
  IN IF rows = Rejected THEN s ELSE rows
SidebarLayouts ==
  LET flat == Flat(s)
      added == Slot(Len(flat) + 1, Blank)
      moved == UNION {LET base == Remove(s, item.id)
                      IN {AppliedOrSame(base, item, zone) : zone \in ExplicitZones}
                       : item \in {flat[i] : i \in Positions(flat)}}
  IN {AppliedOrSame(s, added, zone) : zone \in ExplicitZones} \cup moved
CapacityWithSidebar ==
  \E rows \in CapacityCandidates \cup SidebarLayouts: s' = Canonical(rows)

CapacitySlotCap == Len(Flat(s)) <= MaxSlots
CapacityRowCount == Len(s) \in 1..MaxRows /\ \A r \in Positions(s): Len(s[r]) >= 1
CapacityColumns == \A r \in Positions(s): Len(s[r]) <= MaxColumns
SafetyView == [s EXCEPT !.fault = NoFault]

CapacityBounds ==
  /\ Len(s) \in 1..MaxRows
  /\ Len(Flat(s)) \in 1..MaxSlots
  /\ \A r \in Positions(s): Len(s[r]) \in 1..MaxColumns
CapOperations ==
  Len(Flat(s)) = MaxSlots =>
    /\ Auto(s) = FullZone
    /\ Zones(s) = {}
    /\ {Len(Flat(rows)) : rows \in CapacityCandidates} = {MaxSlots - 1, MaxSlots}
\* The draft case exercises openMany with two distinct threads. After an open
\* succeeds, its resulting route is the input to the next open.
BatchOnDraft ==
  /\ s.rows = <<>> /\ s.route = Blank
  /\ \E first \in Threads: \E second \in Threads \ {first}, zone \in SidebarZones(Current.rows, first):
       LET a == OpenResult(s, first, zone)
           b == OpenResult(a.state, second, AutoZone)
           shown == CurrentAt(b.state).rows
           lost == \/ a.opened # first \/ b.opened # second
                   \/ Refs(shown, first) = {} \/ Refs(shown, second) = {}
       IN s' = [b.state EXCEPT !.fault = IF lost THEN "lostBatchOpen" ELSE NoFault]
BatchNext == Navigate(Blank) \/ BatchOnDraft \/ UNCHANGED s
NoLostBatchOpen == s.fault # "lostBatchOpen"
=============================================================================
