<template>
  <div class="h-full flex flex-col bg-slate-50/30">
    <header v-if="!hideHeader" class="flex items-center gap-3 px-6 py-2 border-b border-slate-200 bg-white">
      <button
        v-if="!embedded"
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
        :title="t('collectionsView.backToIndex')"
        :aria-label="t('collectionsView.backToIndex')"
        data-testid="collections-back"
        @click="goBack"
      >
        <span class="material-icons text-lg">arrow_back</span>
      </button>

      <div v-if="collection" class="h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
        <span class="material-symbols-outlined text-xl">{{ collection.icon }}</span>
      </div>

      <div class="flex-1 min-w-0">
        <h1 class="text-base font-bold text-slate-800 truncate">
          {{ collection?.title ?? t("collectionsView.title") }}
        </h1>
        <span v-if="collection" class="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          {{ collection.slug }}
        </span>
      </div>

      <component
        :is="pinToggle"
        v-if="collection && !embedded"
        :kind="isFeedRoute ? 'feed' : 'collection'"
        :slug="collection.slug"
        :title="collection.title"
        :icon="collection.icon"
      />

      <button
        v-if="collection?.schema.ingest"
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-600 font-bold text-xs transition-colors disabled:opacity-50"
        :disabled="refreshing"
        data-testid="collections-refresh-feed"
        @click="refreshFeed"
      >
        <span class="material-icons text-sm">{{ refreshing ? "hourglass_empty" : "refresh" }}</span>
        <span>{{ t("collectionsView.refreshFeed") }}</span>
      </button>

      <button
        v-if="collection"
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-600 font-bold text-xs transition-colors"
        data-testid="collections-chat"
        @click="openChat"
      >
        <span class="material-icons text-sm">forum</span>
        <span>{{ t("collectionsView.chat") }}</span>
      </button>

      <!-- Collection-level actions (schema `collectionActions`). No record
           context: each seeds a chat with a progress summary of all items. -->
      <button
        v-for="action in collectionActions"
        :key="action.id"
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-600 font-bold text-xs transition-colors disabled:opacity-50"
        :disabled="collectionActionPending"
        :data-testid="`collections-action-${action.id}`"
        @click="runCollectionAction(action)"
      >
        <span v-if="action.icon" class="material-icons text-sm">{{ action.icon }}</span>
        <span>{{ action.label }}</span>
      </button>

      <!-- Hidden in calendar view: there, creation happens via the day view's
           + button, which opens the new-item form in the popup's right pane. -->
      <button
        v-if="canCreate && !calendarActive"
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors shadow-sm"
        data-testid="collections-add-item"
        @click="openCreate"
      >
        <span class="material-icons text-sm">add</span>
        <span>{{ t("common.add") }}</span>
      </button>

      <button
        v-if="canDeleteCollection && !embedded"
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 transition-colors"
        :title="t('collectionsView.deleteCollection')"
        :aria-label="t('collectionsView.deleteCollection')"
        data-testid="collections-delete"
        @click="confirmCollectionDelete"
      >
        <span class="material-icons text-sm">delete_forever</span>
      </button>

      <button
        v-if="canDeleteFeed && !embedded"
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 transition-colors"
        :title="t('collectionsView.deleteFeed')"
        :aria-label="t('collectionsView.deleteFeed')"
        data-testid="feeds-delete"
        @click="confirmFeedDelete"
      >
        <span class="material-icons text-sm">delete_forever</span>
      </button>
    </header>

    <!-- Transient note for an agent-ingest Refresh: the worker runs in the
         background, so records don't update synchronously — tell the user the
         refresh started rather than leaving the click feeling like a no-op. -->
    <div
      v-if="refreshNote"
      class="mx-6 mt-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-2 text-sm text-indigo-800 flex items-center gap-2"
      data-testid="collections-refresh-note"
    >
      <span class="material-icons text-base text-indigo-600">hourglass_top</span>
      <span class="flex-1">{{ refreshNote }}</span>
    </div>

    <!-- Search Toolbar. Shown when there are items to search OR when a view
         toggle is available — the toggle must reach an empty date-bearing
         collection (empty-day create) and a collection whose only views are
         custom ones (so its buttons + the "+" stay reachable). -->
    <div
      v-if="collection && ((!hideSearch && items.length > 0) || (!hideViewToggle && (hasCalendar || hasKanban || hasCustomViews || canAddCustomView)))"
      class="px-6 py-3 bg-white border-b border-slate-100 flex items-center justify-between gap-4"
    >
      <div v-if="!hideSearch && items.length > 0" class="relative flex-1 max-w-md">
        <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 pointer-events-none">
          <span class="material-icons text-lg">search</span>
        </span>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('collectionsView.searchPlaceholder')"
          :aria-label="t('collectionsView.searchPlaceholder')"
          class="w-full bg-slate-50 border border-slate-200/80 rounded-xl pl-9 pr-8 py-1.5 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all font-medium"
        />
        <button
          v-if="searchQuery"
          type="button"
          :aria-label="t('collectionsView.clearSearch')"
          class="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600"
          @click="searchQuery = ''"
        >
          <span class="material-icons text-sm">close</span>
        </button>
      </div>
      <div class="flex items-center gap-2">
        <!-- View toggle: table ↔ calendar ↔ kanban. Calendar shows only when
             the schema has a `date` field, kanban only with an `enum` field;
             local UI state, never persisted. -->
        <div
          v-if="!hideViewToggle && (hasCalendar || hasKanban || hasCustomViews || canAddCustomView)"
          class="flex gap-0.5"
          role="group"
          :aria-label="t('collectionsView.viewToggle')"
        >
          <button
            type="button"
            class="h-8 px-2.5 flex items-center gap-1 rounded text-xs font-bold transition-colors"
            :class="activeView === 'table' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'"
            :aria-pressed="activeView === 'table'"
            data-testid="collection-view-toggle-table"
            @click="setView('table')"
          >
            <span class="material-icons text-sm">table_rows</span>
            <span>{{ t("collectionsView.viewTable") }}</span>
          </button>
          <button
            v-if="hasCalendar"
            type="button"
            class="h-8 px-2.5 flex items-center gap-1 rounded text-xs font-bold transition-colors"
            :class="activeView === 'calendar' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'"
            :aria-pressed="activeView === 'calendar'"
            data-testid="collection-view-toggle-calendar"
            @click="setView('calendar')"
          >
            <span class="material-icons text-sm">calendar_month</span>
            <span>{{ t("collectionsView.viewCalendar") }}</span>
          </button>
          <button
            v-if="hasKanban"
            type="button"
            class="h-8 px-2.5 flex items-center gap-1 rounded text-xs font-bold transition-colors"
            :class="activeView === 'kanban' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'"
            :aria-pressed="activeView === 'kanban'"
            data-testid="collection-view-toggle-kanban"
            @click="setView('kanban')"
          >
            <span class="material-icons text-sm">view_kanban</span>
            <span>{{ t("collectionsView.viewKanban") }}</span>
          </button>
          <!-- Custom (LLM-authored) views declared on the schema. -->
          <button
            v-for="cv in customViews"
            :key="cv.id"
            type="button"
            class="h-8 px-2.5 flex items-center gap-1 rounded text-xs font-bold transition-colors"
            :class="activeView === customViewKey(cv.id) ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'"
            :aria-pressed="activeView === customViewKey(cv.id)"
            :data-testid="`collection-view-custom-${cv.id}`"
            @click="setCustomView(cv.id)"
          >
            <span class="material-icons text-sm">{{ cv.icon || (cv.target === "mobile" ? "smartphone" : "dashboard_customize") }}</span>
            <span>{{ cv.label }}</span>
          </button>
          <!-- "+" — ask Claude to author a new custom view for this collection. -->
          <button
            v-if="canAddCustomView"
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
            :title="t('collectionsView.addView')"
            :aria-label="t('collectionsView.addView')"
            data-testid="collection-view-add"
            @click="addCustomView"
          >
            <span class="material-icons text-sm">add</span>
          </button>
          <!-- Gear — per-collection config (currently: manage/delete custom
               views). Standalone only, and only when there's a view to manage. -->
          <button
            v-if="canConfigureViews"
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
            :title="t('collectionsView.config.open')"
            :aria-label="t('collectionsView.config.open')"
            data-testid="collection-config-open"
            @click="configOpen = true"
          >
            <span class="material-icons text-sm">settings</span>
          </button>
        </div>
        <!-- Which date field anchors the grid (only when >1 date field). -->
        <select
          v-if="calendarActive && dateFields.length > 1"
          :value="calendarAnchorField"
          class="h-8 px-2 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-600 focus:outline-none focus:border-indigo-500 cursor-pointer"
          :aria-label="t('collectionsView.calendarFieldLabel')"
          data-testid="collection-calendar-field"
          @change="anchorOverride = ($event.target as HTMLSelectElement).value"
        >
          <option v-for="key in dateFields" :key="key" :value="key">{{ collection?.schema.fields[key]?.label ?? key }}</option>
        </select>
        <!-- Which enum field groups the board (only when >1 enum field). -->
        <select
          v-if="kanbanActive && enumFields.length > 1"
          :value="kanbanGroupField"
          class="h-8 px-2 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-600 focus:outline-none focus:border-indigo-500 cursor-pointer"
          :aria-label="t('collectionsView.kanbanFieldLabel')"
          data-testid="collection-kanban-field"
          @change="kanbanOverride = ($event.target as HTMLSelectElement).value"
        >
          <option v-for="key in enumFields" :key="key" :value="key">{{ collection?.schema.fields[key]?.label ?? key }}</option>
        </select>
        <div v-if="items.length > 0" class="text-[10px] text-slate-400 font-bold uppercase tracking-wider select-none">
          {{ t("collectionsView.searchSummary", { shown: filteredItems.length, total: items.length }) }}
        </div>
      </div>
    </div>

    <!-- Repair banner: the server flagged record files that won't load /
         violate the schema and are silently skipped. The button reports
         them back to the LLM (same path presentCollection uses) so it
         fixes the files. View-independent, so it sits above the body. -->
    <div
      v-if="collection && dataIssues.length > 0"
      class="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900 shadow-sm flex items-center gap-3"
      data-testid="collections-data-issues"
    >
      <span class="material-icons text-amber-600">warning</span>
      <span class="flex-1">{{ t("collectionsView.dataIssuesDetected", { count: dataIssues.length }) }}</span>
      <button
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-amber-300 bg-white hover:bg-amber-100 text-amber-700 font-bold text-xs transition-colors"
        data-testid="collections-repair"
        @click="repairCollection"
      >
        <span class="material-icons text-sm">build</span>
        <span>{{ t("collectionsView.repair") }}</span>
      </button>
    </div>

    <div class="flex-1 overflow-auto">
      <div v-if="loading" class="flex flex-col items-center justify-center py-20 text-sm text-slate-500 gap-3">
        <div class="h-8 w-8 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
        <span>{{ t("common.loading") }}</span>
      </div>

      <div v-else-if="loadError" class="m-6 rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3">
        <span class="material-icons text-red-600">error</span>
        <span>{{ loadError === "not-found" ? t("collectionsView.notFound") : `${t("collectionsView.loadFailed")}: ${loadError}` }}</span>
      </div>

      <div v-else-if="!collection">
        <!-- defensive: loading=false, error=null, collection=null -->
      </div>

      <!-- Calendar body: an alternative to the table for date-bearing
           collections. Shown whenever active (even when empty) so the
           empty-cell create affordance stays available. -->
      <div v-else-if="calendarActive" class="p-4">
        <CollectionCalendarView
          :schema="collection.schema"
          :items="filteredItems"
          :anchor-field="calendarAnchorField"
          :end-field="calendarEndField"
          :time-field="calendarTimeField"
          :color-field="hasKanban ? kanbanGroupField : ''"
          :selected="viewing ? String(viewing[collection.schema.primaryKey] ?? '') : undefined"
          @select="onCalendarSelect"
          @open-day="onOpenDay"
        />

        <!-- Day (time-allocation) popup. Selecting a record opens it on the
             right of this modal (the `#detail` slot), replacing the old panel
             that sat below the grid. -->
        <CollectionDayView
          v-if="openDay"
          :schema="collection.schema"
          :items="filteredItems"
          :day="openDay"
          :anchor-field="calendarAnchorField"
          :end-field="calendarEndField"
          :time-field="calendarTimeField"
          :color-field="hasKanban ? kanbanGroupField : ''"
          :selected="viewing ? String(viewing[collection.schema.primaryKey] ?? '') : undefined"
          :can-create="canCreate"
          :show-detail="Boolean(viewing || editing)"
          @select="onCalendarSelect"
          @create-on="createOnDate"
          @close="onDayClose"
        >
          <template #detail>
            <CollectionRecordPanel
              v-model:editing="editing"
              :collection="collection"
              :viewing="viewing"
              :saving="saving"
              :save-error="saveError"
              :action-error="actionError"
              :action-pending="actionPending"
              :visible-actions="visibleActions"
              :live-record="liveRecord"
              :live-derived="liveDerived"
              :view-title="viewTitle"
              :is-singleton="isSingleton"
              :render="render"
              :locale="locale"
              @submit="saveEditor"
              @cancel="cancelEditor"
              @edit="editFromView"
              @close="onDayClose"
              @delete="viewing && confirmDelete(viewing)"
              @run-action="runAction"
              @item-chat="onItemChat"
            />
          </template>
        </CollectionDayView>

        <!-- Undated records (the "no date" tray) have no timeline slot, so
             they open in the shared record modal (rendered once at the View
             root) instead of the day view. -->
      </div>

      <!-- Kanban body: an alternative to the table for enum-bearing
           collections. The board groups records into columns by the chosen
           enum field; dragging a card between columns writes that field. -->
      <div v-else-if="kanbanActive" class="h-full flex flex-col">
        <!-- Inline-edit failure banner: a card drop (group-field write) was
             rolled back. The detail panel's `saveError` isn't shown during a
             drag, so inline edits surface their own — same as the table. -->
        <div
          v-if="inlineError"
          class="m-3 mb-0 rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3"
          data-testid="collections-inline-error"
        >
          <span class="material-icons text-red-600">error</span>
          <span class="flex-1">{{ t("collectionsView.inlineSaveFailed", { error: inlineError }) }}</span>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-red-600 hover:bg-red-100"
            :aria-label="t('common.close')"
            @click="inlineError = null"
          >
            <span class="material-icons text-base">close</span>
          </button>
        </div>
        <div class="flex-1 min-h-0 px-3 py-2">
          <CollectionKanbanView
            :schema="collection.schema"
            :items="filteredItems"
            :group-field="kanbanGroupField"
            :selected="viewing ? String(viewing[collection.schema.primaryKey] ?? '') : undefined"
            :notified="notifiedSeverities"
            @select="onCalendarSelect"
            @move="onKanbanMove"
          />
        </div>
      </div>

      <!-- Custom (LLM-authored) HTML view, rendered in a sandboxed iframe over
           the collection's records. Placed before the empty states so it shows
           even for an empty collection (e.g. a still-empty year grid). A
           mobile-target view renders in the phone-frame preview instead — the
           host-wrapped srcdoc + postMessage bridge, exactly what the phone
           remote receives. -->
      <div v-else-if="activeCustomView" class="h-full" data-testid="collection-custom-view-body">
        <CollectionRemoteViewPreview
          v-if="activeCustomView.target === 'mobile'"
          :slug="collection.slug"
          :view="activeCustomView"
          @start-chat="onCustomViewStartChat"
        />
        <CollectionCustomView v-else :slug="collection.slug" :view="activeCustomView" @open-item="onCustomViewOpenItem" @start-chat="onCustomViewStartChat" />
      </div>

      <div v-else-if="items.length === 0 && editing?.mode !== 'create'" class="flex flex-col items-center justify-center py-20 text-sm text-slate-400 gap-2">
        <span class="material-icons text-4xl text-slate-300">folder_open</span>
        <p class="font-semibold text-slate-600">{{ t("collectionsView.itemsEmpty") }}</p>
      </div>

      <div
        v-else-if="filteredItems.length === 0 && editing?.mode !== 'create'"
        class="flex flex-col items-center justify-center py-20 text-sm text-slate-400 gap-2"
      >
        <span class="material-icons text-4xl text-slate-300">search_off</span>
        <p class="font-semibold text-slate-600">{{ t("collectionsView.noMatchingItems") }}</p>
        <button type="button" class="text-xs text-indigo-600 font-semibold hover:underline" @click="searchQuery = ''">
          {{ t("collectionsView.clearSearch") }}
        </button>
      </div>

      <div v-else class="overflow-x-auto [container-type:inline-size]">
        <!-- Inline-edit failure banner: a cell write (checkbox/dropdown)
             was rolled back; the detail panel's `saveError` isn't visible
             here so inline edits surface their own. -->
        <div
          v-if="inlineError"
          class="m-4 rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3"
          data-testid="collections-inline-error"
        >
          <span class="material-icons text-red-600">error</span>
          <span class="flex-1">{{ t("collectionsView.inlineSaveFailed", { error: inlineError }) }}</span>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-red-600 hover:bg-red-100"
            :aria-label="t('common.close')"
            @click="inlineError = null"
          >
            <span class="material-icons text-base">close</span>
          </button>
        </div>
        <table class="min-w-full text-xs">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200">
              <th
                v-for="[key, field] in listColumnFields"
                :key="key"
                :aria-sort="isSortableField(field) ? sortAriaValue(key) : undefined"
                class="px-5 py-3 font-bold text-slate-500 text-left uppercase tracking-wider whitespace-nowrap"
              >
                <div class="flex items-center gap-1">
                  <span class="truncate max-w-[14rem]" :title="field.label">{{ field.label }}</span>
                  <button
                    v-if="isSortableField(field)"
                    type="button"
                    class="inline-flex items-center justify-center rounded p-0.5 -my-1 leading-none transition-colors"
                    :class="sortButtonClass(key)"
                    :data-testid="`collections-sort-${key}`"
                    :aria-label="t('collectionsView.sortBy', { field: field.label })"
                    @click.stop="cycleSort(key)"
                    @pointerenter="hoveredSortKey = key"
                    @pointerleave="hoveredSortKey = null"
                  >
                    <span class="material-icons text-base align-middle">{{ sortIconName(key) }}</span>
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            <template v-for="item in sortedItems" :key="String(item[collection.schema.primaryKey] ?? '')">
              <tr
                class="hover:bg-slate-50/70 cursor-pointer transition-colors focus:outline-none focus:bg-indigo-50/30"
                :class="isRowOpen(item) || isEditingRow(item) ? 'bg-indigo-50/40' : ''"
                role="button"
                tabindex="0"
                :aria-label="t('collectionsView.openItem', { id: String(item[collection.schema.primaryKey] ?? '') })"
                :data-testid="`collections-row-${item[collection.schema.primaryKey]}`"
                @click="openView(item)"
                @keydown.enter.self="openView(item)"
                @keydown.space.self.prevent="openView(item)"
              >
                <td v-for="[key, field] in listColumnFields" :key="key" class="px-5 py-2 text-slate-700 align-middle max-w-xs font-medium">
                  <!-- Conditionally hidden field (`when` predicate) → blank cell. -->
                  <template v-if="fieldVisible(field, item)">
                    <!-- Toggle → inline checkbox projecting an enum field.
                         Stores nothing itself; toggling writes onValue/
                         offValue to the projected field via the same PUT. -->
                    <input
                      v-if="field.type === 'toggle'"
                      type="checkbox"
                      :checked="toggleChecked(item, field)"
                      :disabled="isRowInlineSaving(item)"
                      class="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer align-middle disabled:opacity-50 disabled:cursor-not-allowed"
                      :data-testid="`collections-inline-toggle-${key}-${item[collection.schema.primaryKey]}`"
                      :aria-label="field.label"
                      @click.stop
                      @change="commitToggle(item, field)"
                    />

                    <!-- Boolean → inline checkbox. Tap toggles + saves
                         immediately; `@click.stop` so it doesn't open the
                         row's detail panel. Unset (undefined) and explicit
                         false both render unchecked. -->
                    <input
                      v-else-if="field.type === 'boolean'"
                      type="checkbox"
                      :checked="item[key] === true"
                      :disabled="isRowInlineSaving(item)"
                      class="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20 cursor-pointer align-middle disabled:opacity-50 disabled:cursor-not-allowed"
                      :data-testid="`collections-inline-bool-${key}-${item[collection.schema.primaryKey]}`"
                      :aria-label="field.label"
                      @click.stop
                      @change="commitInlineEdit(item, String(key), field, ($event.target as HTMLInputElement).checked)"
                    />

                    <!-- Ref link badge (binding-driven nav, router-optional) -->
                    <span v-else-if="field.type === 'ref' && field.to && typeof item[key] === 'string' && item[key]" class="block truncate">
                      <a
                        :href="cui.recordHref?.(field.to, String(item[key]))"
                        :tabindex="cui.recordHref?.(field.to, String(item[key])) ? undefined : 0"
                        role="link"
                        class="text-indigo-600 hover:text-indigo-800 hover:underline font-semibold"
                        :data-testid="`collections-ref-link-${key}-${item[key]}`"
                        @click="activateRefLink($event, field.to, String(item[key]), true)"
                        @keydown.enter="activateRefLink($event, field.to, String(item[key]), true)"
                        @keydown.space="activateRefLink($event, field.to, String(item[key]), true)"
                        >{{ refDisplay(field.to, String(item[key])) }}</a
                      >
                    </span>

                    <!-- Enum → inline dropdown. Selecting writes + saves
                         immediately; the empty placeholder clears the field.
                         `@click.stop` keeps the row's detail panel closed. -->
                    <select
                      v-else-if="field.type === 'enum' && Array.isArray(field.values) && field.values.length > 0"
                      :value="item[key] == null ? '' : String(item[key])"
                      :disabled="isRowInlineSaving(item)"
                      class="rounded-lg border px-2 py-0.5 text-[11px] font-semibold focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      :class="enumControlClass(String(key), item[key])"
                      :data-testid="`collections-inline-enum-${key}-${item[collection.schema.primaryKey]}`"
                      :aria-label="field.label"
                      @click.stop
                      @change="commitInlineEdit(item, String(key), field, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-if="showEnumPlaceholder(item, String(key))" value="">{{ t("collectionsView.selectPlaceholder") }}</option>
                      <option v-for="value in field.values" :key="value" :value="value">{{ value }}</option>
                    </select>

                    <!-- Money -->
                    <span v-else-if="field.type === 'money'" class="block truncate tabular-nums font-semibold text-slate-900">{{
                      formatMoney(item[key], resolveCurrency(field, item), locale)
                    }}</span>

                    <!-- Table summary counter -->
                    <span
                      v-else-if="field.type === 'table'"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200/40"
                    >
                      <span class="material-icons text-[11px]">list</span>
                      <span>{{ tableSummary(item[key]) }}</span>
                    </span>

                    <!-- Derived formula fields -->
                    <span
                      v-else-if="field.type === 'derived'"
                      class="inline-block truncate tabular-nums font-bold text-indigo-900 bg-indigo-50/50 px-1.5 py-0.5 rounded border border-indigo-100/50"
                      >{{ derivedDisplay(field, evaluateDerivedAgainstItem(field, String(key), item), item) }}</span
                    >

                    <!-- URL string → external link (new tab). `@click.stop` so
                     clicking the link doesn't also open the row's detail. -->
                    <a
                      v-else-if="field.type !== 'file' && isExternalUrl(item[key])"
                      :href="String(item[key])"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="block truncate text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                      :data-testid="`collections-url-link-${key}-${item[collection.schema.primaryKey]}`"
                      @click.stop
                      >{{ String(item[key]) }}</a
                    >

                    <!-- File: served HTML/SVG artifact → open the rendered
                         app in a new tab. `@click.stop` keeps the row's
                         detail panel from also opening. -->
                    <a
                      v-else-if="field.type === 'file' && artifactUrl(item[key])"
                      :href="artifactUrl(item[key]) ?? undefined"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="block truncate text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                      :data-testid="`collections-file-link-${key}-${item[collection.schema.primaryKey]}`"
                      @click.stop
                      >{{ String(item[key]) }}</a
                    >

                    <!-- File: any other workspace path → open in File Explorer. -->
                    <a
                      v-else-if="field.type === 'file' && fileRoutePath(item[key])"
                      :href="fileRoutePath(item[key]) ?? undefined"
                      class="block truncate text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                      :data-testid="`collections-file-link-${key}-${item[collection.schema.primaryKey]}`"
                      @click="activatePathLink($event, fileRoutePath(item[key]) ?? '', true)"
                      >{{ String(item[key]) }}</a
                    >

                    <span v-else class="block truncate text-slate-600">{{ formatCell(item[key], field.type) }}</span>
                  </template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Shared record modal — the single open/edit surface for every view
         mode (table / kanban) and the calendar's undated tray.
         Calendar's DATED records keep their day-view modal (which embeds the
         same panel on its right), so this is suppressed while that's open. -->
    <CollectionRecordModal v-if="collection && (viewing || editing) && !(calendarActive && openDay)" @close="closeRecordModal">
      <CollectionRecordPanel
        v-model:editing="editing"
        :collection="collection"
        :viewing="viewing"
        :saving="saving"
        :save-error="saveError"
        :action-error="actionError"
        :action-pending="actionPending"
        :visible-actions="visibleActions"
        :live-record="liveRecord"
        :live-derived="liveDerived"
        :view-title="viewTitle"
        :is-singleton="isSingleton"
        :render="render"
        :locale="locale"
        @submit="saveEditor"
        @cancel="cancelEditor"
        @edit="editFromView"
        @close="closeView"
        @delete="viewing && confirmDelete(viewing)"
        @run-action="runAction"
        @item-chat="onItemChat"
      />
    </CollectionRecordModal>

    <!-- Per-collection config (gear): manage/delete custom views. -->
    <CollectionViewConfigModal
      v-if="configOpen && collection"
      :slug="collection.slug"
      :title="collection.title"
      :views="customViews"
      @changed="onViewsChanged"
      @close="configOpen = false"
    />

    <!-- Chat modal — collect a message and start a new general-role chat
         seeded with the collection's skill command (`/<slug> <message>`). -->
    <div
      v-if="chatOpen && collection"
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-all duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collections-chat-title"
      data-testid="collections-chat-modal"
      @click.self="closeChat"
      @keydown.esc="closeChat"
    >
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col border border-slate-200 overflow-hidden">
        <header class="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
          <div class="h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/50">
            <span class="material-icons text-lg">forum</span>
          </div>
          <div class="flex-1">
            <h2 id="collections-chat-title" class="text-sm font-bold text-slate-800 uppercase tracking-wide">{{ t("collectionsView.chatTitle") }}</h2>
            <span class="text-xs text-slate-400 font-semibold">{{ collection.title }}</span>
          </div>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 transition-colors"
            :aria-label="t('common.close')"
            data-testid="collections-chat-close"
            @click="closeChat"
          >
            <span class="material-icons text-lg">close</span>
          </button>
        </header>

        <div class="px-6 py-5">
          <textarea
            ref="chatInputEl"
            v-model="chatMessage"
            rows="4"
            :placeholder="t('collectionsView.chatPlaceholder')"
            class="w-full bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all resize-none"
            data-testid="collections-chat-input"
            @keydown.meta.enter="submitChat"
            @keydown.ctrl.enter="submitChat"
          ></textarea>
        </div>

        <footer class="px-6 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/50">
          <button
            type="button"
            class="h-8 px-2.5 rounded text-xs font-bold text-slate-500 hover:bg-slate-200/50 transition-colors"
            data-testid="collections-chat-cancel"
            @click="closeChat"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            class="h-8 px-2.5 rounded bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm shadow-indigo-600/10"
            :disabled="!chatMessage.trim()"
            data-testid="collections-chat-send"
            @click="submitChat"
          >
            {{ t("collectionsView.chatStart") }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useCollectionI18n } from "../lang";
import CollectionRecordModal from "./CollectionRecordModal.vue";
import CollectionCalendarView from "./CollectionCalendarView.vue";
import CollectionDayView from "./CollectionDayView.vue";
import CollectionKanbanView from "./CollectionKanbanView.vue";
import CollectionRecordPanel from "./CollectionRecordPanel.vue";
import CollectionViewConfigModal from "./CollectionViewConfigModal.vue";
import CollectionCustomView from "./CollectionCustomView.vue";
import CollectionRemoteViewPreview from "./CollectionRemoteViewPreview.vue";
import { useCollectionRendering } from "../useCollectionRendering";
import {
  readCollectionViewMode,
  writeCollectionViewMode,
  readCollectionSort,
  writeCollectionSort,
  customViewKey,
  type CollectionViewMode,
  type BuiltInViewMode,
} from "../collectionViewMode";
import { collectionUi } from "../uiContext";
import { activateRefLink, activatePathLink } from "../refLink";
import {
  dateOf,
  isSortableField,
  nextSortDirection,
  sortItems,
  numericSortValue,
  stringSortValue,
  dateSortValue,
  enumSortValue,
  boolSortValue,
  shortHexId,
  defangForPrompt,
  actionVisible,
  fieldVisible,
  resolveEnumColor,
  buildUpdatedRecord,
  coerceInlineValue,
  draftToRecord,
  firstMissingRequiredField,
  rowFromItem,
  type Ymd,
  type SortState,
  type SortValue,
  type CollectionAction,
  type CollectionCustomView as CustomViewSpec,
  type CollectionDetail,
  type CollectionItem,
  type CollectionFieldSpec as FieldSpec,
  type CollectionRecordIssue,
  type CollectionNotifySeverity,
  type EditState,
  type TableRowDraft,
} from "@mulmoclaude/core/collection";

/** `slug` / `selected` are supplied only in EMBEDDED mode (the
 *  `presentCollection` chat card mounts this component and drives both
 *  from the tool result). In standalone route mode (the
 *  `/collections/:slug` page) both are undefined and the component reads
 *  `route.params.slug` / `route.query.selected` as before.
 *
 *  `sendTextMessage` is forwarded ONLY by the chat card — its presence
 *  is our "rendered inside a chat" signal. When set, chat-triggering
 *  actions send into the current session instead of spawning a new
 *  chat (see `runAction` / `submitChat`). */
const props = defineProps<{
  slug?: string;
  selected?: string;
  sendTextMessage?: (text?: string) => void;
  /** Embedded mode only: initial view / anchor / group restored from the
   *  card's persisted `viewState` so a switch to calendar or kanban
   *  survives a remount. (The table sort is NOT a card prop — it's a shared
   *  per-collection localStorage preference, read by both modes.) Accepts a
   *  `custom:<id>` mode too so the dashboard can open a tile directly on a
   *  custom view. */
  initialView?: CollectionViewMode;
  initialAnchorField?: string;
  initialGroupField?: string;
  /** Hide the header's view-mode toggle (table ↔ calendar ↔ kanban ↔
   *  custom + "add view"). The dashboard sets this because each tile
   *  carries its own view picker, persisting the choice to the dashboard
   *  layout rather than the card/localStorage. Search stays available. */
  hideViewToggle?: boolean;
  /** Hide the top header (icon / title / chat / add / delete). The
   *  dashboard sets this because each tile renders its own header
   *  (drag handle + icon + title + view picker), so the view's built-in
   *  header would be a redundant second title bar. */
  hideHeader?: boolean;
  /** Hide the record search input. The dashboard sets this to keep tiles
   *  compact; with the toggle also hidden the whole toolbar collapses. */
  hideSearch?: boolean;
}>();

const emit = defineEmits<{
  /** Embedded mode only: the open record changed (id) or closed (null).
   *  The card persists this in its tool-result `viewState` so the open
   *  item survives a re-render. */
  select: [id: string | null];
  /** Embedded mode only: the view mode / calendar anchor / kanban group
   *  changed. The card persists these alongside `selected` so the calendar
   *  and kanban stick. (The table sort is shared via localStorage instead.) */
  viewStateChange: [state: { view: BuiltInViewMode; anchorField: string; groupField: string }];
}>();

const { t, locale } = useCollectionI18n();
// All host couplings (data, routing, confirm, chat, shortcuts, notifications,
// the pin toggle) come through the injected CollectionUi binding. The aliases
// keep the body's call sites unchanged where the host shape matched 1:1.
const cui = collectionUi();
const { confirm: openConfirm, unpin, pinToggle, startChat } = cui;
const appApi = { startNewChat: startChat };

/** Embedded when a `slug` prop is supplied; standalone (route-driven)
 *  otherwise. Switches the slug/selected source and the open/close
 *  navigation behaviour. */
const embedded = computed<boolean>(() => props.slug !== undefined);

/** Active collection slug: the prop in embedded mode, else the route
 *  param. */
const activeSlug = computed<string | undefined>(() => {
  if (props.slug !== undefined) return props.slug;
  const slug = cui.routeSlug();
  return slug !== undefined && slug.length > 0 ? slug : undefined;
});

/** Active open-record id: the prop in embedded mode (may be undefined),
 *  else the `?selected=` query. */
const activeSelected = computed<string | undefined>(() => {
  if (embedded.value) return props.selected;
  return cui.routeSelectedId();
});

const collection = ref<CollectionDetail | null>(null);
const items = ref<CollectionItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
// Record files the server flagged as malformed/invalid (silently skipped
// at read time). When non-empty the view shows a Repair banner whose
// button reports them back to the LLM. See `repairCollection`.
const dataIssues = ref<CollectionRecordIssue[]>([]);

// Primary-key → notification severity for this collection's records that
// currently have an active bell notification — passed to the Kanban board so
// it can flag those cards in the matching bell colour (urgent red / nudge amber).
const notifiedSeverities = computed<Map<string, CollectionNotifySeverity>>(() => {
  const slug = collection.value?.slug;
  return slug ? cui.notifiedSeverities(slug) : new Map<string, CollectionNotifySeverity>();
});
/** True while a feed collection's manual refresh is in flight. */
const refreshing = ref(false);
/** Transient note shown after an agent-ingest Refresh dispatches a background
 *  worker (records update asynchronously, so there's nothing to show inline).
 *  Auto-clears; `refreshNoteTimer` cancels a pending clear on re-trigger. */
const refreshNote = ref<string | null>(null);
let refreshNoteTimer: ReturnType<typeof setTimeout> | undefined;
/** Slug already auto-refreshed on first open — prevents a reload loop
 *  (the auto-refresh reloads the view, which would re-trigger otherwise). */
const autoRefreshedSlug = ref<string | null>(null);
const editing = ref<EditState | null>(null);
/** The record currently shown in read-only "open" mode. Distinct
 *  from `editing`: open mode renders formatted values (no inputs)
 *  and is what a `/collections/<slug>?selected=<id>` deep link
 *  lands on. Mutually exclusive with `editing` in practice —
 *  `editFromView` hands off from one to the other. */
const viewing = ref<CollectionItem | null>(null);
/** The calendar day whose time-allocation popup is open, or null. The
 *  selected record (`viewing`) renders in that popup's right pane; a record
 *  with no resolvable day falls back to the panel below the grid. */
const openDay = ref<Ymd | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);
/** Error from an inline table-cell edit (checkbox/dropdown). Distinct
 *  from `saveError` (rendered only inside the detail panel, which is
 *  closed during inline editing) — shown as a banner above the table. */
const inlineError = ref<string | null>(null);
/** Per-load snapshot of enum cells that had NO value when fetched
 *  (keyed `<rowId>:<fieldKey>`). Only these cells offer the empty
 *  placeholder option in their inline dropdown — a cell that already
 *  has a value can't be blanked inline (use the edit form for that). */
const enumOriginallyEmpty = ref<Set<string>>(new Set());
/** Rows with an inline cell save in flight (by `rowId`). While a row is
 *  here its inline controls are disabled, so two quick edits to the same
 *  row can't race two full-record PUTs — an older PUT landing last would
 *  otherwise clobber the newer field on disk while the UI shows the
 *  newer optimistic value (Codex PR #1599 P2). */
const inlineSavingRows = ref<Set<string>>(new Set());
const actionPending = ref(false);
const actionError = ref<string | null>(null);
const collectionActionPending = ref(false);
const chatOpen = ref(false);
const chatMessage = ref("");
const chatInputEl = ref<HTMLTextAreaElement | null>(null);

// Shared rendering + linked-data layer: owns the ref/embed caches and
// every value-formatting helper, reused by the extracted record panel
// (table + calendar) so there's one implementation. Destructure the
// helpers the list table renders with; pass the whole object to the
// panel as its `render` prop.
const render = useCollectionRendering(collection, locale);
const {
  refRecordCache,
  refDisplay,
  formatMoney,
  resolveCurrency,
  derivedDisplay,
  evaluateDerivedAgainstItem,
  formatCell,
  isExternalUrl,
  artifactUrl,
  fileRoutePath,
} = render;

const searchQuery = ref("");

/** Case-insensitive substring match across an item's scalar fields.
 *  Object-valued fields (table rows, nested records) are skipped —
 *  they don't render as searchable text in the list table. */
function itemMatchesQuery(item: CollectionItem, query: string): boolean {
  return Object.values(item).some((val) => {
    if (val === undefined || val === null || typeof val === "object") return false;
    return String(val).toLowerCase().includes(query);
  });
}

const filteredItems = computed<CollectionItem[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return items.value;
  return items.value.filter((item) => itemMatchesQuery(item, query));
});

// ── List-table sort (single active column, header toggle) ─────────
// Calendar / kanban keep their own ordering; only the table consumes
// `sortedItems`. The active sort is a single SHARED per-collection
// preference in localStorage — both the standalone page and embedded chat
// cards read AND write it, so a sort set anywhere is consistent the next
// time the collection is viewed. Resets only when a DIFFERENT collection
// loads (the slug watch), so the sort survives a refresh / edit / remount.
function storedSortFor(slug: string | undefined): SortState | null {
  return (slug && readCollectionSort(slug)) || null;
}
const sortState = ref<SortState | null>(storedSortFor(activeSlug.value));
// The schema's declared default sort, used only when the user has set no
// explicit sort of their own. Ignored when it names a field the loaded schema
// no longer has (e.g. renamed away) so a stale default can't wedge the table.
const schemaDefaultSort = computed<SortState | null>(() => {
  const def = collection.value?.schema.defaultSort;
  return def && collection.value?.schema.fields[def.field] ? { field: def.field, direction: def.direction } : null;
});
// The sort actually applied to the table: an explicit user sort wins;
// otherwise the schema default; otherwise none (source order). Persistence
// still tracks only `sortState`, so we never write the schema default back
// into the user's localStorage.
const effectiveSort = computed<SortState | null>(() => sortState.value ?? schemaDefaultSort.value);
// The column whose sort button is currently hovered (at most one). Hover
// previews the NEXT click's state, so descending visibly fades back to the
// light-grey "off" look — signalling the next click clears the sort.
const hoveredSortKey = ref<string | null>(null);

function sortDirectionFor(key: string): "asc" | "desc" | null {
  return effectiveSort.value?.field === key ? effectiveSort.value.direction : null;
}

/** The direction whose visuals to render: on hover, preview the next
 *  click's state; otherwise show the column's actual state. */
function effectiveSortDir(key: string): "asc" | "desc" | null {
  const current = sortDirectionFor(key);
  return hoveredSortKey.value === key ? nextSortDirection(current) : current;
}

/** Cycle a column none → asc → desc → none; activating one clears the rest. */
function cycleSort(key: string): void {
  const next = nextSortDirection(sortDirectionFor(key));
  sortState.value = next ? { field: key, direction: next } : null;
}

function sortIconName(key: string): string {
  return effectiveSortDir(key) === "desc" ? "arrow_downward" : "arrow_upward";
}

// Dark grey while a direction is active; light grey for the "off" state —
// so hovering a descending column previews the cleared look.
function sortButtonClass(key: string): string {
  return effectiveSortDir(key) ? "text-slate-600" : "text-slate-300";
}

/** ARIA `aria-sort` token for a column's header cell. */
function sortAriaValue(key: string): "ascending" | "descending" | "none" {
  const dir = sortDirectionFor(key);
  return dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";
}

/** Comparable value for scalar fields that key off the raw cell value. */
function scalarSortValue(field: FieldSpec, raw: unknown): SortValue {
  switch (field.type) {
    case "number":
    case "money":
      return numericSortValue(raw);
    case "date":
    case "datetime":
      return dateSortValue(raw);
    case "enum":
      return enumSortValue(field.values, raw);
    case "boolean":
      return boolSortValue(raw === true);
    case "ref":
      return field.to && typeof raw === "string" && raw ? stringSortValue(refDisplay(field.to, raw)) : stringSortValue(raw);
    default:
      return stringSortValue(raw);
  }
}

/** Comparable value for one row under the active field. Toggle and derived
 *  need the whole record; every other type keys off the raw cell. */
function sortValueOf(field: FieldSpec, key: string, item: CollectionItem): SortValue {
  if (field.type === "toggle") return boolSortValue(toggleChecked(item, field));
  if (field.type === "derived") return derivedSortValue(field, key, item);
  return scalarSortValue(field, item[key]);
}

/** Derived rows sort by their display type: money/number → numeric,
 *  date/datetime → epoch, anything else → the enriched value as a string. */
function derivedSortValue(field: FieldSpec, key: string, item: CollectionItem): SortValue {
  const { display } = field;
  if (display === undefined || display === "number" || display === "money") {
    return numericSortValue(evaluateDerivedAgainstItem(field, key, item));
  }
  const enriched = collection.value ? render.deriveAll(collection.value.schema, item, render.refRecordCache.value) : item;
  if (display === "date" || display === "datetime") return dateSortValue(enriched[key]);
  return stringSortValue(enriched[key]);
}

const sortedItems = computed<CollectionItem[]>(() => {
  const state = effectiveSort.value;
  const field = state ? collection.value?.schema.fields[state.field] : undefined;
  if (!state || !field) return filteredItems.value;
  return sortItems(filteredItems.value, state.direction, (item) => sortValueOf(field, state.field, item));
});

// ────────────────────────────────────────────────────────────────
// Open / edit record panel (shared modal + calendar day view)
// ────────────────────────────────────────────────────────────────
// Detail, edit, and create all render `CollectionRecordPanel` inside the
// shared `CollectionRecordModal` (or the calendar day view for dated
// records). One panel open at a time (`viewing` / `editing` are single
// refs). The list table only highlights the open/edited row.

/** Stringified primary-key value for a row (the row's stable identity). */
function rowId(item: CollectionItem): string {
  const primaryKey = collection.value?.schema.primaryKey;
  return primaryKey ? String(item[primaryKey] ?? "") : "";
}

/** Stable key for one cell in the `enumOriginallyEmpty` snapshot. */
function cellKey(rowIdValue: string, fieldKey: string): string {
  return `${rowIdValue}:${fieldKey}`;
}

/** Build the set of enum cells that were empty in the freshly-fetched
 *  records — the only cells whose inline dropdown offers an empty option. */
function snapshotEmptyEnums(schema: CollectionDetail["schema"], records: CollectionItem[]): Set<string> {
  const empty = new Set<string>();
  const enumKeys = Object.entries(schema.fields)
    .filter(([, field]) => field.type === "enum")
    .map(([fieldKey]) => fieldKey);
  if (enumKeys.length === 0) return empty;
  for (const record of records) {
    const recordId = String(record[schema.primaryKey] ?? "");
    for (const fieldKey of enumKeys) {
      if (record[fieldKey] == null || record[fieldKey] === "") empty.add(cellKey(recordId, fieldKey));
    }
  }
  return empty;
}

/** Whether an inline enum dropdown should render its empty placeholder
 *  option: only for cells with no value at load time. */
function showEnumPlaceholder(item: CollectionItem, fieldKey: string): boolean {
  return enumOriginallyEmpty.value.has(cellKey(rowId(item), fieldKey));
}

/** Tailwind fill/text/border classes tinting an inline enum `<select>` by its
 *  current value's colour (palette, or notification red/amber/grey when the
 *  field is the schema's notifyWhen target). */
function enumControlClass(fieldKey: string, value: unknown): string {
  const schema = collection.value?.schema;
  if (!schema) return "";
  const cls = resolveEnumColor(schema, fieldKey, value);
  return `${cls.badge} ${cls.border}`;
}

/** This row is the one open in read-only detail. */
function isRowOpen(item: CollectionItem): boolean {
  return viewing.value !== null && rowId(viewing.value) === rowId(item);
}

/** This row is the one being edited (highlights it in the list while the
 *  edit modal is open). Create mode has no backing row, so nothing matches. */
function isEditingRow(item: CollectionItem): boolean {
  const draft = editing.value;
  if (!draft || draft.mode === "create") return false;
  return draft.originalId === rowId(item);
}

/** Re-run a feed collection's retrieval now, then reload its records.
 *  Only reachable when `schema.ingest` is present (button is gated). */
async function refreshFeed(): Promise<void> {
  const current = collection.value;
  if (!current?.schema.ingest || refreshing.value) return;
  refreshing.value = true;
  inlineError.value = null;
  const result = await cui.refreshCollection(current.slug);
  refreshing.value = false;
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  await loadCollection(current.slug);
  // refreshOne reports retriever failures via `errors` even on HTTP 200, so
  // surface them — otherwise a failed refresh looks like success.
  if (result.data.errors.length > 0) {
    inlineError.value = t("collectionsView.refreshFailed", { error: result.data.errors.join("; ") });
    return;
  }
  // Agent ingest dispatched a worker — records update later. A manual refresh
  // runs a VISIBLE session: open it so the user can watch/debug the run. Fall
  // back to a transient note if the host can't navigate (router-less embed).
  if (result.data.dispatched) {
    if (result.data.chatId && cui.navigate) cui.navigate(`/chat/${result.data.chatId}`);
    else showRefreshNote(t("collectionsView.refreshDispatched"));
  }
}

/** Show a transient refresh note, replacing any pending auto-clear. */
function showRefreshNote(message: string): void {
  refreshNote.value = message;
  if (refreshNoteTimer !== undefined) clearTimeout(refreshNoteTimer);
  refreshNoteTimer = setTimeout(() => {
    refreshNote.value = null;
    refreshNoteTimer = undefined;
  }, 6000);
}

/** Collection-level header actions. No `when` predicate (no record). */
const collectionActions = computed<CollectionAction[]>(() => collection.value?.schema.collectionActions ?? []);

/** Run a collection-level action: ask the server to assemble the seed
 *  prompt (a progress summary of all records + the template), then start
 *  a new chat in the action's role with it. Generic — no domain knowledge. */
async function runCollectionAction(action: CollectionAction): Promise<void> {
  const current = collection.value;
  if (!current || collectionActionPending.value) return;
  collectionActionPending.value = true;
  inlineError.value = null;
  const result = await cui.runCollectionAction(current.slug, action.id);
  collectionActionPending.value = false;
  if (!result.ok) {
    inlineError.value = result.error;
    return;
  }
  if (props.sendTextMessage) {
    props.sendTextMessage(result.data.prompt);
    return;
  }
  appApi.startNewChat(result.data.prompt, result.data.role);
}

/** Report the server-detected record data problems back to the LLM so it
 *  fixes the offending files. Mirrors the `presentCollection` validation
 *  path (`dispatchPresentCollection`), but user-initiated via the Repair
 *  button instead of fired automatically after a write. Dispatches into
 *  the current chat when embedded, else seeds a new General chat. */
function repairCollection(): void {
  const current = collection.value;
  if (!current || dataIssues.value.length === 0) return;
  // Issue text carries record-controlled values (ids, enum values), so defang
  // structural injection vectors before it rides into the LLM prompt. Shared
  // with the server's presentCollection path via `defangForPrompt` so the two
  // can't drift (it also collapses whitespace, closing a newline-injection gap).
  const lines = dataIssues.value.map((issue) => `- ${defangForPrompt(issue.file)}: ${defangForPrompt(issue.problem)}`).join("\n");
  const prompt = t("collectionsView.repairPrompt", { title: current.title, count: dataIssues.value.length, issues: lines });
  if (props.sendTextMessage) {
    props.sendTextMessage(prompt);
    return;
  }
  appApi.startNewChat(prompt, cui.generalRoleId);
}

/** Actions whose optional `when` predicate matches the open record.
 *  Status-driven buttons (e.g. invoice "Record payment") stay hidden
 *  until the record reaches the matching state. */
const visibleActions = computed<CollectionAction[]>(() => {
  const record = viewing.value;
  if (!record) return [];
  return (collection.value?.schema.actions ?? []).filter((action) => actionVisible(action, record));
});

/** Run a schema-declared action on the open record: ask the server to
 *  assemble the seed prompt, then start a new chat in the action's
 *  role with it. Generic — no knowledge of what the action does. */
async function runAction(action: CollectionAction): Promise<void> {
  if (!collection.value || !viewing.value) return;
  const itemId = String(viewing.value[collection.value.schema.primaryKey] ?? "");
  if (!itemId) return;
  actionPending.value = true;
  actionError.value = null;
  const result = await cui.runItemAction(collection.value.slug, itemId, action.id);
  actionPending.value = false;
  if (!result.ok) {
    actionError.value = result.error;
    return;
  }
  // In a chat card we have a channel into the current session — send
  // the seed prompt there rather than spawning a new chat. Standalone
  // route mode has no such channel, so start a fresh chat in the
  // action's role (which carries the tools the action needs).
  if (props.sendTextMessage) {
    props.sendTextMessage(result.data.prompt);
    return;
  }
  appApi.startNewChat(result.data.prompt, result.data.role);
}

/** Open the chat modal, blanking any prior draft and focusing the input. */
function openChat(): void {
  chatMessage.value = "";
  chatOpen.value = true;
  void nextTick(() => chatInputEl.value?.focus());
}

function closeChat(): void {
  chatOpen.value = false;
}

/** Build the chat seed text for the current view.
 *
 *  A collection IS a skill, so its slug doubles as a slash command:
 *  "I want to create an item" on `mc_worklog` becomes
 *  `/mc_worklog I want to create an item`.
 *
 *  A feed is data-only — it has NO skill, so `/<slug>` would resolve to
 *  nothing. Instead, point the agent at the feed's schema + records
 *  (`feeds/<slug>/schema.json` and `<dataPath>/`) and let it act on the
 *  request directly. */
function buildChatSeed(slug: string, message: string, itemId?: string): string {
  const current = collection.value;
  // Only an actual Feed (source `feed`) is skill-less + data-only. A
  // skill-backed collection — even one carrying an agent-ingest block — DOES
  // have a `/<slug>` skill command, so seed that. (Checked via `source`
  // directly, not the `isFeed` computed defined further down, to keep this
  // helper self-contained and avoid a use-before-define.)
  if (current?.source !== "feed") return itemId ? `/${slug} id=${itemId} ${message}` : `/${slug} ${message}`;
  const dataPath = current.schema.dataPath ?? `data/feeds/${slug}`;
  // A feed has no skill command — point the agent at a specific record by id
  // inside the same schema-driven seed.
  const scoped = itemId ? `(for record \`${itemId}\`) ${message}` : message;
  return t("collectionsView.feedChatSeed", { slug, dataPath, message: scoped });
}

/** Start a new general-role chat seeded from the current view. */
function submitChat(): void {
  if (!collection.value) return;
  const message = chatMessage.value.trim();
  if (!message) return;
  closeChat();
  const text = buildChatSeed(collection.value.slug, message);
  // Chat card → send into the current session; standalone → new chat.
  if (props.sendTextMessage) {
    props.sendTextMessage(text);
    return;
  }
  appApi.startNewChat(text, cui.generalRoleId);
}

/** The open record's chat box: start a chat scoped to that one record. Seeds
 *  the collection's skill command with an `id=<itemId>` selector
 *  (`/<slug> id=<itemId> <message>`) so the agent acts on this record. */
function onItemChat(message: string): void {
  if (!collection.value || !viewing.value) return;
  const text = message.trim();
  if (!text) return;
  const itemId = String(viewing.value[collection.value.schema.primaryKey] ?? "");
  const seed = buildChatSeed(collection.value.slug, text, itemId || undefined);
  // Chat card → send into the current session; standalone → new chat.
  if (props.sendTextMessage) {
    props.sendTextMessage(seed);
    return;
  }
  appApi.startNewChat(seed, cui.generalRoleId);
}

async function loadCollection(slug: string): Promise<void> {
  // Snapshot the shortcut kind BEFORE the await — if the user navigates
  // between /feeds/:slug and /collections/:slug while the fetch is in
  // flight, reading route.name in the 404 branch could unpin the wrong
  // (kind, slug) pair.
  const requestedKind = !embedded.value && cui.isFeedRoute() ? "feed" : "collection";
  loading.value = true;
  loadError.value = null;
  collection.value = null;
  items.value = [];
  dataIssues.value = []; // never carry a previous collection's issues over
  searchQuery.value = ""; // Reset search query on collection load
  // NOTE: the active column sort is NOT reset here — it's part of the view
  // state, so it must survive a refresh / edit reload and an embedded card
  // remount. The collection-SWITCH reset lives in the `activeSlug` watch.
  render.resetLinkedCaches();
  viewing.value = null;
  openDay.value = null; // never carry a previous collection's open day over
  const result = await cui.fetchCollectionDetail(slug);
  loading.value = false;
  if (!result.ok) {
    loadError.value = result.status === 404 ? "not-found" : result.error;
    // Dead-click safety net: a pinned shortcut for a collection/feed
    // deleted out-of-band (e.g. via chat) lands here. Self-prune it so
    // the launcher doesn't keep a button that 404s. Standalone only
    // (embedded cards carry no shortcut), and only if we're still on the
    // slug that triggered this fetch.
    if (result.status === 404 && !embedded.value && activeSlug.value === slug) {
      void unpin(requestedKind, slug);
    }
    return;
  }
  collection.value = result.data.collection;
  items.value = result.data.items;
  dataIssues.value = result.data.issues ?? [];
  enumOriginallyEmpty.value = snapshotEmptyEnums(result.data.collection.schema, result.data.items);
  // Fan out to fetch each unique target collection so the table can
  // render ref values as display names (not slugs) and the form
  // dropdown has options. Failures fall back gracefully — the table
  // cell shows the raw slug and the form falls back to text input.
  // Pass the slug that triggered THIS load so the helper can drop
  // its result if a faster subsequent load has already switched us
  // to a different collection (Codex P1 review on PR #1495).
  await render.loadLinkedCollections(result.data.collection.schema, slug);
  // A `?selected=<id>` deep link opens that record in read-only
  // mode once its items are available. Guard against a stale load:
  // only act if we're still on the slug that triggered this fetch.
  // Deliberately DON'T force calendar view here: the earlier
  // `maybeOpenCalendarForSelected` behaviour also wrote "calendar" to
  // localStorage, permanently overriding the user's table/kanban
  // preference for that collection. Deep-linked records open in the
  // user's saved view; if they want the calendar day popup, they can
  // switch to calendar from the header (#1675).
  if (collection.value?.slug === slug) {
    syncViewToSelected();
  }
  maybeAutoRefreshFeed(slug);
}

/** Refresh records + schema IN PLACE for a live (pub/sub-driven) update,
 *  preserving the user's browsing state — unlike `loadCollection`, which is the
 *  route-change path and resets it. Specifically: does NOT null `collection`
 *  (so the layout and an active custom-view iframe don't remount), keeps
 *  `searchQuery` / `openDay` / `sortState`, and shows no loading spinner; the
 *  open detail (`viewing`) is re-resolved against the fresh records by id, so it
 *  follows an edited record and closes only if the record was deleted. A failed
 *  fetch is a no-op (keep the current data) — a transient blip shouldn't blank a
 *  view the user is reading. */
async function refreshItemsInPlace(slug: string): Promise<void> {
  const result = await cui.fetchCollectionDetail(slug);
  // Bail if the fetch failed or the user switched collections mid-flight.
  if (!result.ok || activeSlug.value !== slug) return;
  collection.value = result.data.collection;
  items.value = result.data.items;
  dataIssues.value = result.data.issues ?? [];
  enumOriginallyEmpty.value = snapshotEmptyEnums(result.data.collection.schema, result.data.items);
  await render.loadLinkedCollections(result.data.collection.schema, slug);
  if (activeSlug.value !== slug) return; // re-check after the await
  // Keep an open detail modal pointed at the fresh record object (or close it
  // if the record is now gone) — `viewing` holds a stale reference otherwise.
  if (viewing.value) {
    const openId = String(viewing.value[result.data.collection.schema.primaryKey] ?? "");
    viewing.value = findItemById(openId) ?? null;
  }
}

// First-open auto-refresh: when a feed view opens with no records yet
// (e.g. a just-registered feed that hasn't hit the scheduler), fetch once
// so data appears without a manual Refresh. Guarded per slug so the reload
// `refreshFeed` triggers can't loop; the view re-mounts per slug, so each
// open retries at most once.
//
// Restricted to ACTUAL feeds (`source === "feed"`): a declarative feed
// populates synchronously here, but a skill-backed `ingest.kind: "agent"`
// collection would dispatch a VISIBLE worker and navigate the user to its
// chat just by opening an empty collection — those refresh on schedule or an
// explicit Refresh click only.
function maybeAutoRefreshFeed(slug: string): void {
  if (embedded.value) return;
  const current = collection.value;
  if (current?.slug !== slug || current.source !== "feed") return;
  if (items.value.length > 0 || autoRefreshedSlug.value === slug) return;
  autoRefreshedSlug.value = slug;
  void refreshFeed();
}

/** Schema fields excluding display-only `embed` fields — used by the
 *  list table only (a whole embedded record doesn't fit a table cell,
 *  and it'd be identical in every row). The detail modal and the edit
 *  form iterate the full `schema.fields` so embeds render there too. */
// Fields shown as columns in the list table. Excludes `embed`
// (display-only fixed record, no per-record value), `image` — a
// per-row <img> fetches one file each, too expensive for a collection
// with many records, and the image is shown in the detail view anyway —
// and the primary key (an id is plumbing, not data: it identifies the
// row via data-testid / ref links but doesn't earn a column).
const listColumnFields = computed<[string, FieldSpec][]>(() =>
  collection.value
    ? Object.entries(collection.value.schema.fields).filter(
        ([key, field]) => field.type !== "embed" && field.type !== "image" && key !== collection.value?.schema.primaryKey,
      )
    : [],
);

/** True when the current collection declares `schema.singleton` —
 *  exactly one record, its primary key fixed to the declared value. */
const isSingleton = computed<boolean>(() => Boolean(collection.value?.schema.singleton));

/** Whether the Add button should show. Always for a normal collection;
 *  for a singleton only until its one record exists. */
const canCreate = computed<boolean>(() => {
  if (!collection.value) return false;
  return !(isSingleton.value && items.value.length > 0);
});

// A collection is deletable only when it's project-scope AND not a
// preset (`mc-*`) — mirrors the server-side rule in
// `deleteCollection`. User-scope skills are read-only from MulmoClaude;
// presets re-seed on restart so deleting them is futile.
const canDeleteCollection = computed<boolean>(() => {
  const current = collection.value;
  if (!current) return false;
  return current.source === "project" && !current.slug.startsWith("mc-");
});

// True only for an actual Feed (discovered from `feeds/<slug>/`, source
// `feed`) — NOT merely any collection carrying an `ingest` block. A
// skill-backed collection can now declare `ingest.kind: "agent"` (scheduled
// agent refresh) yet still be a project-scope collection, deleted the normal
// way; keying off `schema.ingest` here used to surface a SECOND delete button
// on those. Feeds are deleted via DELETE /api/feeds/:slug.
const isFeed = computed<boolean>(() => collection.value?.source === "feed");
const canDeleteFeed = computed<boolean>(() => isFeed.value && !embedded.value);

// Which list to return to from the back arrow: feeds opened via /feeds
// go back to the feed list; everything else to the collections index.
const isFeedRoute = computed<boolean>(() => !embedded.value && cui.isFeedRoute());

// ── View mode (table | calendar | kanban) ─────────────────────────
// Local UI state only — NEVER persisted to schema. The user toggles it;
// the host never flips it programmatically. The calendar is offered only
// when the schema has a `date` field and the kanban only when it has an
// `enum` field, so plain collections and the initial load are unchanged
// (default "table").
//
// Standalone route mode persists the last-used mode per collection in
// localStorage so reopening `/collections/:slug` restores the prior view
// instead of always starting on the table. Embedded chat cards restore from
// the card's own `initialView` first; lacking that (a freshly-rendered
// presentCollection card), they fall back to the same per-collection store
// the standalone page uses, so a card also opens in the last-used view.
// `CollectionViewMode` ("table" | "calendar" | "kanban" | "dashboard" |
// `custom:<id>`) is imported from the view-mode util.

/** The view to open with: the embedded card's restored `initialView` if
 *  present (its own persisted state wins), else the slug's stored
 *  preference, else "table". Embedded cards READ the store but never WRITE
 *  it (the persist watch only emits `viewStateChange` for them), so a stale
 *  card re-rendering can't clobber the shared preference. */
function initialViewMode(): CollectionViewMode {
  if (props.initialView) return props.initialView;
  const slug = activeSlug.value;
  return (slug && readCollectionViewMode(slug)) || "table";
}
const view = ref<CollectionViewMode>(initialViewMode());

/** `date` / `datetime` fields in declaration order — the calendar can anchor
 *  on any (a `datetime` anchor also carries the clock for the day view). */
const dateFields = computed<string[]>(() =>
  collection.value
    ? Object.entries(collection.value.schema.fields)
        .filter(([, field]) => field.type === "date" || field.type === "datetime")
        .map(([key]) => key)
    : [],
);

/** Whether the table ↔ calendar toggle is offered. */
const hasCalendar = computed<boolean>(() => dateFields.value.length > 0);

/** `enum` fields in declaration order — the kanban can group on any. */
const enumFields = computed<string[]>(() =>
  collection.value
    ? Object.entries(collection.value.schema.fields)
        .filter(([, field]) => field.type === "enum")
        .map(([key]) => key)
    : [],
);

/** Whether the kanban toggle is offered (needs an `enum` field to group on). */
const hasKanban = computed<boolean>(() => enumFields.value.length > 0);

/** The effective view, collapsing any stale mode whose enabling field
 *  vanished (e.g. `view = "kanban"` after switching to an enum-less
 *  collection) back to "table". Single source of truth for the toggle and
 *  the body branches. */
/** Custom (LLM-authored) HTML views declared on the schema. Mobile-target
 *  views need the host's `fetchRemoteView` binding (the phone-frame preview's
 *  data source) — on a host without it they're hidden from the selector. */
const customViews = computed<CustomViewSpec[]>(() => {
  const views = collection.value?.schema.views ?? [];
  return cui.fetchRemoteView ? views : views.filter((entry) => entry.target !== "mobile");
});
const hasCustomViews = computed<boolean>(() => customViews.value.length > 0);

const activeView = computed<CollectionViewMode>(() => {
  if (view.value === "calendar" && hasCalendar.value) return "calendar";
  if (view.value === "kanban" && hasKanban.value) return "kanban";
  if (view.value.startsWith("custom:")) {
    const viewId = view.value.slice("custom:".length);
    if (customViews.value.some((entry) => entry.id === viewId)) return view.value;
  }
  return "table";
});

/** The selected custom view's spec, or null when a built-in view is active. */
const activeCustomView = computed<CustomViewSpec | null>(() => {
  const mode = activeView.value;
  if (!mode.startsWith("custom:")) return null;
  const viewId = mode.slice("custom:".length);
  return customViews.value.find((entry) => entry.id === viewId) ?? null;
});

/** Narrow a (possibly custom) mode to a built-in one, used where only the
 *  built-in views are representable (the embedded card's viewState). */
function builtInViewOrTable(mode: CollectionViewMode): BuiltInViewMode {
  return mode === "calendar" || mode === "kanban" ? mode : "table";
}

/** Whether to offer the "+" (author a new custom view) button. Standalone
 *  page only (the seed starts a chat). Feeds qualify too — their views are
 *  authored under feeds/<slug>/ and the seed prompt points there. */
const canAddCustomView = computed<boolean>(() => Boolean(collection.value) && !embedded.value);

/** Seed a chat asking Claude to author a new custom view for this collection.
 *  Reuses the same chat-seed path as collection actions — the host injects a
 *  templated prompt; Claude asks, authors the HTML, and registers it. The
 *  authoring base is source-aware: a feed lives under `feeds/<slug>/`, every
 *  other collection under the `data/skills/<slug>/` staging dir. */
function addCustomView(): void {
  const current = collection.value;
  if (!current) return;
  const base = current.source === "feed" ? `feeds/${current.slug}` : `data/skills/${current.slug}`;
  const prompt = t("collectionsView.addViewPrompt", { title: current.title, base });
  if (props.sendTextMessage) {
    props.sendTextMessage(prompt);
    return;
  }
  appApi.startNewChat(prompt, cui.generalRoleId);
}

// ── Per-collection config (gear → manage custom views) ──────────────
const configOpen = ref<boolean>(false);

/** Whether to offer the config gear. Standalone page only, and only when
 *  there's a deletable custom view to manage — i.e. the collection is one
 *  whose views the server will delete (project non-preset, or a feed; never a
 *  read-only user-scope skill). Mirrors the server's refusal rules. */
const canConfigureViews = computed<boolean>(() => !embedded.value && hasCustomViews.value && (canDeleteCollection.value || isFeed.value));

/** Reload the collection after the config modal deletes a view so the toggle
 *  row + the modal's own list reflect the removal. */
async function onViewsChanged(): Promise<void> {
  const current = collection.value;
  if (current) await loadCollection(current.slug);
}

/** True when the calendar is the active body. */
const calendarActive = computed<boolean>(() => activeView.value === "calendar");

/** True when the kanban is the active body. */
const kanbanActive = computed<boolean>(() => activeView.value === "kanban");

// In-view override for which enum field groups the board; null ⇒ the schema
// hint, else the first enum field.
const kanbanOverride = ref<string | null>(props.initialGroupField ?? null);
const kanbanGroupField = computed<string>(() => {
  if (kanbanOverride.value && enumFields.value.includes(kanbanOverride.value)) return kanbanOverride.value;
  const hint = collection.value?.schema.kanbanField;
  if (hint && enumFields.value.includes(hint)) return hint;
  return enumFields.value[0] ?? "";
});

// In-view override for which date field anchors the grid; null ⇒ the
// schema hint, else the first date field.
const anchorOverride = ref<string | null>(props.initialAnchorField ?? null);
const calendarAnchorField = computed<string>(() => {
  if (anchorOverride.value && dateFields.value.includes(anchorOverride.value)) return anchorOverride.value;
  const hint = collection.value?.schema.calendarField;
  if (hint && dateFields.value.includes(hint)) return hint;
  return dateFields.value[0] ?? "";
});
// The end field pairs with `schema.calendarField`. If the user switches the
// in-view anchor to a different date field, the span no longer applies —
// drop it so chips don't render from the new start to the original end.
const calendarEndField = computed<string | undefined>(() => {
  const schema = collection.value?.schema;
  if (!schema?.calendarEndField) return undefined;
  return calendarAnchorField.value === schema.calendarField ? schema.calendarEndField : undefined;
});
// The time-string field (e.g. ENGAGEMENTS' "time") that places records on the
// day view. Like the end field, it pairs with the schema's `calendarField` —
// dropped when the in-view anchor is switched to a different date field.
const calendarTimeField = computed<string | undefined>(() => {
  const schema = collection.value?.schema;
  if (!schema?.calendarTimeField) return undefined;
  return calendarAnchorField.value === schema.calendarField ? schema.calendarTimeField : undefined;
});

function setView(next: CollectionViewMode): void {
  view.value = next;
}

/** Select a custom view by id (builds the `custom:<id>` mode key). */
function setCustomView(viewId: string): void {
  const mode: CollectionViewMode = `custom:${viewId}`;
  view.value = mode;
}

/** A short, slug-safe id not already used by a loaded record. Collisions
 *  are astronomically unlikely (32 bits), but we still re-roll a few
 *  times against the in-memory set before giving up and using the last
 *  candidate (the server's overwrite guard is the final backstop). */
function generateUniqueItemId(primaryKey: string): string {
  const existing = new Set(items.value.map((item) => String(item[primaryKey] ?? "")));
  let candidate = shortHexId();
  for (let attempt = 0; attempt < 8 && existing.has(candidate); attempt++) {
    candidate = shortHexId();
  }
  return candidate;
}

function openCreate(): void {
  if (!collection.value) return;
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  const table: Record<string, TableRowDraft[]> = {};
  for (const [key, field] of Object.entries(collection.value.schema.fields)) {
    if (field.type === "boolean") {
      bool[key] = false;
      // New record — no boolean was originally present.
      boolOriginallyPresent[key] = false;
      boolTouched[key] = false;
    } else if (field.type === "table") {
      table[key] = [];
    } else if (field.type !== "derived" && field.type !== "embed" && field.type !== "toggle") {
      text[key] = "";
    }
    // derived (computed), embed (display-only, foreign record), and toggle
    // (projection of an enum field) have no draft slot.
  }
  // Singleton collections fix the primary key to the schema-declared
  // value (e.g. "me") so the first Add can't pick an arbitrary id.
  // Otherwise pre-fill a unique, editable id so the user doesn't have to
  // invent one — the primary-key input stays enabled in create mode, so
  // they can still override it before saving. Matches the id shape the
  // server would generate for a blank-id POST (`generateItemId`).
  const { singleton, primaryKey } = collection.value.schema;
  if (singleton) {
    text[primaryKey] = singleton;
  } else if (primaryKey in text) {
    text[primaryKey] = generateUniqueItemId(primaryKey);
  }
  viewing.value = null; // one panel open at a time
  editing.value = { mode: "create", text, bool, boolOriginallyPresent, boolTouched, table, originalId: null };
  saveError.value = null;
}

function openEdit(item: CollectionItem): void {
  if (!collection.value) return;
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  const table: Record<string, TableRowDraft[]> = {};
  for (const [key, field] of Object.entries(collection.value.schema.fields)) {
    const raw = item[key];
    if (field.type === "boolean") {
      bool[key] = raw === true;
      // Track whether the key was present in the source record so
      // we can preserve "omitted" through a save that doesn't
      // touch this field. `typeof raw === "boolean"` is more
      // defensive than `key in item` because a wrong-typed value
      // (e.g. `billable: "yes"`) shouldn't be treated as a real
      // existing boolean state.
      boolOriginallyPresent[key] = typeof raw === "boolean";
      boolTouched[key] = false;
    } else if (field.type === "table" && field.of) {
      const sub = field.of;
      const rows = Array.isArray(raw) ? raw : [];
      table[key] = rows
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
        .map((row) => rowFromItem(row, sub));
    } else if (field.type !== "derived" && field.type !== "embed" && field.type !== "toggle") {
      text[key] = raw === undefined || raw === null ? "" : String(raw);
    }
  }
  const primaryRaw = item[collection.value.schema.primaryKey];
  const originalId = typeof primaryRaw === "string" ? primaryRaw : String(primaryRaw ?? "");
  viewing.value = null; // one panel open at a time
  editing.value = { mode: "edit", text, bool, boolOriginallyPresent, boolTouched, table, originalId };
  saveError.value = null;
}

function closeEditor(): void {
  editing.value = null;
  saving.value = false;
  saveError.value = null;
}

/** Cancel the editor. Edit → reopen the record's read-only detail (don't
 *  collapse the panel); create → just close (no prior detail to show). */
function cancelEditor(): void {
  const draft = editing.value;
  const returnTo = draft && draft.mode === "edit" ? draft.originalId : null;
  closeEditor();
  if (returnTo) {
    const item = findItemById(returnTo);
    if (item) showDetail(item);
  }
}

/** Open mode (read-only detail). Toggles: clicking the already-open row
 *  collapses it. Opening a row cancels any in-progress edit (one panel
 *  open at a time). In embedded mode, report the open id so the host
 *  card can persist it in `viewState`. */
function openView(item: CollectionItem): void {
  if (isRowOpen(item) && !editing.value) {
    closeView();
    return;
  }
  if (editing.value) closeEditor();
  showDetail(item);
}

/** Open the read-only detail for a record WITHOUT the click-toggle. Used
 *  when reopening detail programmatically (after save / cancel), where
 *  `openView`'s "click the open row to collapse" guard would otherwise
 *  immediately close a row the embedded `viewState` sync just reopened. */
function showDetail(item: CollectionItem): void {
  viewing.value = item;
  actionError.value = null;
  if (embedded.value && collection.value) {
    emit("select", String(item[collection.value.schema.primaryKey] ?? ""));
  }
}

/** Close open mode. Embedded mode reports the close via `select(null)`
 *  (the card clears its `viewState`); standalone mode drops the
 *  `?selected=` query param so a refresh / back-button doesn't reopen
 *  the record and the URL reflects the closed state. */
function closeView(): void {
  viewing.value = null;
  actionError.value = null;
  if (embedded.value) {
    emit("select", null);
    return;
  }
  if (cui.routeSelectedId() !== undefined) {
    cui.setSelectedId(null);
  }
}

/** Backdrop click / Escape on the shared record modal. While editing this
 *  cancels the draft (reopening the detail, matching the in-panel Cancel
 *  button — so a stray click never silently discards edits); while viewing
 *  it closes the detail. */
function closeRecordModal(): void {
  if (editing.value) {
    cancelEditor();
    return;
  }
  closeView();
}

/** Hand off from open mode to the editor for the same record. */
function editFromView(): void {
  const item = viewing.value;
  if (!item) return;
  viewing.value = null;
  openEdit(item);
}

function findItemById(itemId: string): CollectionItem | undefined {
  if (!collection.value) return undefined;
  const { primaryKey } = collection.value.schema;
  return items.value.find((item) => String(item[primaryKey] ?? "") === itemId);
}

/** Reconcile the open-mode view with the `?selected=<id>` query —
 *  the single source of truth for which record is open. Opens the
 *  matching record, or closes the modal when the param is absent /
 *  empty / points at an id that isn't loaded (deleted record, stale
 *  link). Keeping `viewing` in lockstep with the URL means browser
 *  back / forward and a removed param both close the modal instead
 *  of leaving stale UI on screen (Codex P2 + CodeRabbit on #1502). */
function syncViewToSelected(): void {
  const selected = activeSelected.value;
  if (typeof selected !== "string" || selected.length === 0) {
    viewing.value = null;
    return;
  }
  const match = findItemById(selected) ?? null;
  viewing.value = match;
  // A deep link / notification opens the record in the shared modal, which
  // is centred regardless of where the row sits in a long list — no scroll
  // needed (the inline-expansion era required one).
}

/** Title for the open-mode header: the record's primary-key value
 *  (e.g. `INV-2026-0001`), falling back to the collection title.
 *  Non-string primary keys (numeric ids) are stringified rather
 *  than discarded (CodeRabbit on #1502). */
const viewTitle = computed<string>(() => {
  if (!viewing.value || !collection.value) return "";
  const pkValue = viewing.value[collection.value.schema.primaryKey];
  if (pkValue === undefined || pkValue === null || pkValue === "") return collection.value.title ?? "";
  return String(pkValue);
});

/** Live computed record from the current draft. Drives derived
 *  field displays in the form so subtotal/tax/total update as
 *  the user edits line items. */
const liveRecord = computed<CollectionItem | null>(() => {
  if (!collection.value || !editing.value) return null;
  return draftToRecord(editing.value, collection.value.schema);
});

/** Live record with derived fields resolved (drives the form's
 *  read-only derived inputs). Derivation lives in the shared
 *  rendering composable; this binds it to the current draft. */
const liveDerived = computed<CollectionItem | null>(() => {
  if (!collection.value || !liveRecord.value) return null;
  return render.deriveAll(collection.value.schema, liveRecord.value, refRecordCache.value);
});

/** Short summary for a `table`-typed cell in the main collection
 *  table. Counts rows; nothing fancier yet (per-row preview is
 *  hard to fit in a single cell). */
function tableSummary(value: unknown): string {
  if (!Array.isArray(value)) return "—";
  if (value.length === 0) return "—";
  return t("collectionsView.tableSummary", { count: value.length });
}

async function saveEditor(): Promise<void> {
  if (!collection.value || !editing.value) return;
  // Snapshot mutable refs before any await — route changes during
  // the save (e.g. user navigates away) can null `collection.value`
  // and would throw on the post-await `loadCollection(...)`.
  const { slug, schema } = collection.value;
  const draft = editing.value;
  saveError.value = null;

  const missing = firstMissingRequiredField(draft, schema);
  if (missing) {
    saveError.value = `${missing}: ${t("collectionsView.requiredField")}`;
    return;
  }

  saving.value = true;
  const record = draftToRecord(draft, schema);
  const isCreate = draft.mode === "create";
  const result = isCreate ? await cui.createItem(slug, record) : await cui.updateItem(slug, draft.originalId ?? "", record);
  saving.value = false;
  if (!result.ok) {
    saveError.value = result.error;
    return;
  }
  const savedId = result.data.itemId;
  closeEditor();
  await loadCollection(slug);
  // Return to the saved record's read-only detail (for create, this is the
  // newly added row) in the shared modal.
  const saved = findItemById(savedId);
  if (saved) showDetail(saved);
}

/** Write a single cell's value directly onto the live `items` entry.
 *  Reactive in Vue 3 (proxy), so the bound checkbox/select re-renders.
 *  `undefined` (enum cleared to the placeholder) renders as the empty
 *  option; the PUT body omits the key via `buildUpdatedRecord`. */
function applyInlineValue(item: CollectionItem, key: string, value: unknown): void {
  item[key] = value;
}

/** True while this row has an inline cell save in flight — its inline
 *  controls render disabled to serialize edits (one PUT per row). */
function isRowInlineSaving(item: CollectionItem): boolean {
  return inlineSavingRows.value.has(rowId(item));
}

/** Inline table-cell edit (boolean checkbox / enum dropdown): optimistic
 *  update, then PUT the full record. Gated per row so a second edit can't
 *  race the in-flight one. On failure, roll the cell back and surface the
 *  error. Bypasses the detail/edit panel entirely. */
async function commitInlineEdit(item: CollectionItem, key: string, field: FieldSpec, raw: boolean | string): Promise<void> {
  if (!collection.value) return;
  const { slug } = collection.value;
  const itemId = rowId(item);
  if (!itemId || inlineSavingRows.value.has(itemId)) return;
  const previous = item[key];
  const coerced = coerceInlineValue(field, raw);
  applyInlineValue(item, key, coerced);
  inlineError.value = null;
  inlineSavingRows.value.add(itemId);
  const result = await cui.updateItem(slug, itemId, buildUpdatedRecord(item, key, coerced));
  inlineSavingRows.value.delete(itemId);
  if (!result.ok) {
    applyInlineValue(item, key, previous);
    inlineError.value = result.error;
  }
}

/** Whether a `toggle` field reads as checked: its projected enum field
 *  currently equals `onValue`. The toggle stores nothing itself. */
function toggleChecked(item: CollectionItem, field: FieldSpec): boolean {
  return field.field !== undefined && String(item[field.field] ?? "") === field.onValue;
}

/** Flip a `toggle`: write the projected enum field to `offValue` when
 *  currently checked, else `onValue`. Reuses the inline-edit PUT path
 *  (optimistic + rollback) — the toggle has no value of its own. */
function commitToggle(item: CollectionItem, field: FieldSpec): void {
  const targetKey = field.field;
  if (!targetKey || !collection.value) return;
  const enumField = collection.value.schema.fields[targetKey];
  if (!enumField) return;
  const next = toggleChecked(item, field) ? field.offValue : field.onValue;
  if (next === undefined) return;
  void commitInlineEdit(item, targetKey, enumField, next);
}

async function confirmDelete(item: CollectionItem): Promise<void> {
  if (!collection.value) return;
  // Snapshot before any await (see saveEditor) — confirm dialog
  // awaits user input, plenty of time for the route to change.
  const { slug } = collection.value;
  const { primaryKey } = collection.value.schema;
  const idRaw = item[primaryKey];
  const itemId = typeof idRaw === "string" ? idRaw : String(idRaw ?? "");
  if (!itemId) return;
  const ok = await openConfirm({
    message: t("collectionsView.confirmDelete"),
    confirmText: t("common.remove"),
    cancelText: t("common.cancel"),
    variant: "danger",
  });
  if (!ok) return;
  const result = await cui.deleteItem(slug, itemId);
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  await loadCollection(slug);
}

// Delete the whole collection (skill + records), not just one item.
// The server archives a restorable copy first; on success we leave the
// now-gone collection's route for the index.
async function confirmCollectionDelete(): Promise<void> {
  const current = collection.value;
  if (!current) return;
  // Snapshot before the await — the confirm dialog yields control and
  // the route could change underneath us (see confirmDelete).
  const { slug, title } = current;
  const ok = await openConfirm({
    message: t("collectionsView.confirmDeleteCollection", { title }),
    confirmText: t("common.remove"),
    cancelText: t("common.cancel"),
    variant: "danger",
  });
  if (!ok) return;
  const result = await cui.deleteCollection(slug);
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  cui.gotoIndex("collection");
}

function goBack(): void {
  cui.gotoIndex(isFeedRoute.value ? "feed" : "collection");
}

// Delete a feed: remove its feeds/<slug>/ registry entry (records on disk
// are retained), then return to the feed list. Distinct from
// `confirmCollectionDelete`, which archives + deletes a skill-backed
// collection through the project-scope collection-delete route.
async function confirmFeedDelete(): Promise<void> {
  const current = collection.value;
  if (!current) return;
  const { slug, title } = current;
  const ok = await openConfirm({
    message: t("collectionsView.confirmDeleteFeed", { title }),
    confirmText: t("common.remove"),
    cancelText: t("common.cancel"),
    variant: "danger",
  });
  if (!ok) return;
  const result = await cui.deleteFeed(slug);
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  cui.gotoIndex("feed");
}

// Load on slug change, immediate so the initial value (route param or
// prop) triggers the first fetch — replaces the old `onMounted` +
// separate slug watch. Works identically for route mode (reads
// `route.params.slug`) and embedded mode (reads the `slug` prop).
/** Open the create form with the clicked calendar day prefilled into the
 *  anchor field. The calendar day view's + affordance; the create flow itself
 *  is the same one the Add button uses. A `datetime` anchor renders as a
 *  `datetime-local` input, which rejects a bare `YYYY-MM-DD` — seed midnight
 *  so the chosen day actually survives the prefill. */
function createOnDate(iso: string): void {
  if (!canCreate.value) return;
  openCreate();
  const anchor = calendarAnchorField.value;
  if (!editing.value || !anchor) return;
  const anchorType = collection.value?.schema.fields[anchor]?.type;
  editing.value.text[anchor] = anchorType === "datetime" ? `${iso}T00:00` : iso;
}

/** The civil day a record sits on, from its calendar anchor field (handles
 *  both `date` and `datetime`). Null for undated records. */
function dayOfItem(item: CollectionItem): Ymd | null {
  return dateOf(item[calendarAnchorField.value]);
}

/** Mirror the open record into the `?selected=<id>` query (standalone mode)
 *  so the calendar's day-view + selection is a copy-pasteable link. In-app
 *  selection didn't previously touch the URL; the calendar now does. */
function writeSelectedToUrl(itemId: string): void {
  if (embedded.value || cui.routeSelectedId() === itemId) return;
  cui.setSelectedId(itemId);
}

/** Calendar chip / kanban card click → open that record's detail. In the
 *  calendar it opens the day (time-allocation) popup on the record's day with
 *  the detail in the right pane; an undated record falls back to the panel
 *  below the grid. Unlike `openView`, this never toggles — a second click on
 *  the same record keeps it open. */
function onCalendarSelect(itemId: string | null): void {
  if (!itemId) {
    closeView();
    return;
  }
  const item = findItemById(itemId);
  if (!item) return;
  if (editing.value) closeEditor();
  // Anchor the popup on the record's day; null for an undated record, which
  // closes the popup so its detail falls back to the panel below the grid.
  if (calendarActive.value) openDay.value = dayOfItem(item);
  showDetail(item);
  writeSelectedToUrl(itemId);
}

/** A custom (sandboxed) view asked to open a record in the shared modal.
 *  `view` → read-only detail, `edit` → straight into the editor. Ungated: the
 *  capability token governs the view's *code*, not user actions through the
 *  host's own trusted modal (no write happens without an explicit Save). */
function onCustomViewOpenItem(payload: { id: string; mode: "view" | "edit" }): void {
  const item = findItemById(payload.id);
  if (!item) return;
  if (editing.value) closeEditor();
  if (payload.mode === "edit") {
    openEdit(item);
    return;
  }
  showDetail(item);
  writeSelectedToUrl(payload.id);
}

/** The custom view called `__MC_VIEW.startChat(prompt, role)` — open a new chat
 *  with the prompt prefilled as an editable draft. The host validates `role`
 *  (falls back to General). The view's code only proposes text; the user
 *  approves / edits / sends, so no capability is required. */
function onCustomViewStartChat(payload: { prompt: string; role?: string }): void {
  const prompt = payload.prompt.trim();
  if (!prompt) return;
  cui.startNewChatDraft(prompt, payload.role);
}

/** A calendar day cell was activated → open its popup on a clean slate
 *  (clear any prior selection so the popup opens timeline-only). */
function onOpenDay(day: Ymd): void {
  if (editing.value) closeEditor();
  closeView();
  openDay.value = day;
}

/** Close the day popup: drop the open day, the selection, AND any in-progress
 *  draft together. Clearing `editing` matters because the shared record modal
 *  shows whenever `editing` is set and no day is open — so without this, an
 *  edit/create started inside the day popup would re-appear in the centred
 *  modal the instant the popup closed (Codex P2 on #1656). */
function onDayClose(): void {
  openDay.value = null;
  if (editing.value) closeEditor();
  closeView();
}

/** Kanban card dropped in a column → set the record's group field to the
 *  column value (the empty string clears it for the Uncategorized column).
 *  Reuses the inline-edit path (optimistic write + PUT + rollback). */
function onKanbanMove(itemId: string, value: string): void {
  const item = findItemById(itemId);
  const key = kanbanGroupField.value;
  const field = collection.value?.schema.fields[key];
  if (!item || !field) return;
  void commitInlineEdit(item, key, field, value);
}

watch(
  activeSlug,
  (slug, prevSlug) => {
    // Reset view state when switching BETWEEN collections — but not on the
    // initial run (prevSlug undefined), so an embedded card's restored
    // `initialView` / `initialAnchorField` survive the first load. Both modes
    // restore the new collection's stored mode (else "table"); the axis
    // fields always reset to their schema defaults.
    if (prevSlug !== undefined && slug !== prevSlug) {
      view.value = (slug && readCollectionViewMode(slug)) || "table";
      anchorOverride.value = null;
      kanbanOverride.value = null;
      // A sort belongs to a collection's own schema, so don't carry it across —
      // restore the new collection's stored (shared) sort instead.
      sortState.value = storedSortFor(slug);
    }
    if (slug) {
      loadCollection(slug);
    } else {
      collection.value = null;
      items.value = [];
      enumOriginallyEmpty.value = new Set();
      inlineSavingRows.value = new Set();
      searchQuery.value = ""; // Reset search query
      loading.value = false;
    }
  },
  { immediate: true },
);

// ── Live updates ──
// Refetch when the server reports a record change for the active collection —
// agent writes (the common case: a record added/updated mid-chat), UI writes
// from another tab/window, feed refreshes, and host-driven `spawn` successors
// all ride the host's collection-change channel. `subscribeChanges` is an
// OPTIONAL host capability: a host without a pub/sub transport omits it and the
// view simply keeps its existing manual-refresh behaviour.
//
// Debounced so a bulk write (N rows) collapses to one refetch, and DEFERRED
// (not dropped) while an inline/create edit is unsaved so a live refetch never
// clobbers the user's draft. A change that lands mid-edit sets a pending flag
// that the `editing` watch below flushes once the edit ends — whether it ends
// by save or cancel — so a cancelled edit doesn't leave the view stale.
const LIVE_REFRESH_DEBOUNCE_MS = 150;
let changeUnsub: (() => void) | null = null;
let liveRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let pendingRemoteRefresh = false;

function clearLiveRefreshTimer(): void {
  if (liveRefreshTimer !== undefined) {
    clearTimeout(liveRefreshTimer);
    liveRefreshTimer = undefined;
  }
}

function onRemoteChange(slug: string): void {
  clearLiveRefreshTimer();
  liveRefreshTimer = setTimeout(() => {
    liveRefreshTimer = undefined;
    if (editing.value) {
      pendingRemoteRefresh = true; // defer past the edit, don't drop it
      return;
    }
    if (activeSlug.value === slug) void refreshItemsInPlace(slug);
  }, LIVE_REFRESH_DEBOUNCE_MS);
}

// Flush a remote change that arrived mid-edit once the edit ends (save or
// cancel). The save path refetches on its own, but cancel has no other refresh
// path — without this, a cancelled edit would strand the deferred update.
watch(editing, (current) => {
  if (current || !pendingRemoteRefresh) return;
  pendingRemoteRefresh = false;
  if (activeSlug.value) void refreshItemsInPlace(activeSlug.value);
});

watch(
  activeSlug,
  (slug) => {
    changeUnsub?.();
    changeUnsub = null;
    clearLiveRefreshTimer();
    if (slug && cui.subscribeChanges) {
      changeUnsub = cui.subscribeChanges(slug, () => onRemoteChange(slug));
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  changeUnsub?.();
  changeUnsub = null;
  clearLiveRefreshTimer();
  if (refreshNoteTimer !== undefined) clearTimeout(refreshNoteTimer);
});

// Embedded mode: report view/anchor changes so the chat card persists them
// in `viewState` (alongside `selected`). Standalone mode: persist the view
// mode per slug in localStorage so reopening restores it.
// `loading` is a dependency so the write re-runs when the collection finishes
// loading: that's the point where a stored mode unsupported by this schema
// (its date/enum field gone) has collapsed to "table" and must be normalized
// back into storage — otherwise no other dependency changes and it lingers.
watch([activeView, calendarAnchorField, kanbanGroupField, sortState, loading], () => {
  // Persist the EFFECTIVE view (activeView), not the raw `view` ref — a
  // stale "calendar"/"kanban" that has fallen back to "table" (its enabling
  // field gone) must not be saved as an impossible mode.
  if (embedded.value) {
    // Embedded cards persist only the built-in view in v1 — a custom view
    // collapses to "table" for the card's restore state (custom views are a
    // standalone-page feature; widening the card viewState is a follow-up).
    emit("viewStateChange", { view: builtInViewOrTable(activeView.value), anchorField: calendarAnchorField.value, groupField: kanbanGroupField.value });
  }
  // Don't write during the load window: until the collection resolves,
  // `hasCalendar`/`hasKanban` are false so `activeView` reads "table",
  // which would clobber a stored "calendar"/"kanban" before it can apply.
  if (activeSlug.value && !loading.value && collection.value) {
    // View mode stays standalone-authored — embedded reads but never writes it,
    // so a stale card can't clobber the shared mode. The table SORT, by
    // contrast, IS shared both ways: a card always re-reads it on mount, so
    // there's no per-card value to go stale and clobber the store.
    if (!embedded.value) writeCollectionViewMode(activeSlug.value, activeView.value);
    writeCollectionSort(activeSlug.value, sortState.value);
  }
});

// React to the active selection changing while already on this
// collection: follow it to open the new record, OR close the modal when
// it's cleared (browser back / card close) or points at a missing id.
// The initial / cross-collection case is handled by `loadCollection`;
// here we only act once items are loaded.
watch(activeSelected, () => {
  if (loading.value || !collection.value) return;
  syncViewToSelected();
  // Keep the calendar-owned openDay in step with the selection — re-anchor it on
  // the selected record's day, or clear it when the selection is gone. Do this
  // even when the calendar isn't the active view: openDay is calendar state, so
  // a selection cleared in the table must not survive into a later calendar
  // visit. Never force a view switch here — that's loadCollection's deep-link job.
  openDay.value = viewing.value ? dayOfItem(viewing.value) : null;
});
</script>
