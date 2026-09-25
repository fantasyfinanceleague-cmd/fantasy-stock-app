# TradeModal Issues - RESOLVED

All issues fixed on February 1, 2026.

## Issue 1: VirtualizedLists Error - FIXED
- **Problem:** FlatList nested inside ScrollView caused React Native warning
- **Fix:** Replaced FlatList with ScrollView + `.map()` with `nestedScrollEnabled`

## Issue 2: Permanent Refresh Symbol - FIXED
- **Problem:** Loading spinner stayed visible after clearing search input
- **Fix:** Reset `searchLoading` when input is empty or matches selected symbol

## Issue 3: List Formatting / Keyboard Overlap - FIXED
- **Problem:** Search results hidden behind keyboard
- **Fix:** Added `Keyboard.dismiss()` when search results appear
