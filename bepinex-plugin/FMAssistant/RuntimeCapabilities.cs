using System;
using System.IO;
using System.Security.Cryptography;

namespace FMAssistant;

public static class RuntimeCapabilities
{
    public const string ProtocolBuild = "26577676";
    private const string NativeHash = "8c6971ce0b1c8afe6529ea3f46205a5175aea988a97d7421a980da42e23fe340";
    private const string MatchValidationBuild = "26620374";
    private const string MatchValidationNativeHash = "d12202dd01c3911d4c4e55e778f37b2251ffb10f9cf8cecc3b9ec08ece622c6b";
    private const string MatchValidationManagedHash = "3f4a26c4869d6429d2e73c276adc64bdfaf6f3c86ce44fe0de93d14683a5d7e9";
    // 2026-11-25 Steam build 26797085（已基于新版 interop 零警告重编译并通过实机验证）
    private const string CurrentValidationBuild = "26797085";
    private const string CurrentValidationNativeHash = "4781439443abfb4b8197de03f1bed5b76063c862d014cfe01c5f54d83c9875ee";
    private const string CurrentValidationManagedHash = "8b5707a924a6c8cb493cd67bc620be25a456ae5dc6b6f313f3f1d4f70fdeb552";
    internal const string MatchFlowObservation = "observe_match_flow";
    private static readonly string[] MatchValidationRoutes = {
        "/api/v1/game/request-continue",
        "/api/v1/news/set-read-state",
        "/api/v1/news/set-unread-state",
        "/api/v1/news/execute",
        "/api/v1/news/open-press-conference",
        "/api/v1/induction/execute",
        "/api/v1/set-piece/creator-execute",
        "/api/v1/tactics/submit-lineup",
        // 补齐已实现的战术建议、阵容确认/删除与合同金额输入合法赛外路由
        "/api/v1/tactics/suggestion",
        "/api/v1/tactics/team-selection-delete",
        "/api/v1/tactics/confirm-selection",
        "/api/v1/contracts/input-amount",
        "/api/v1/tactic-slots/creator-execute",
        "/api/v1/tactic-slots/execute",
        "/api/v1/tactic-slots/menu-execute",
        "/api/v1/tactic-slots/save-file",
        "/api/v1/commands/set-role",
        "/api/v1/commands/set-formation",
        "/api/v1/commands/set-mentality",
        "/api/v1/commands/set-instruction",
        "/api/v1/training/execute",
        "/api/v1/team-training/execute",
        "/api/v1/team-training/session-execute",
        "/api/v1/team-training/intensity-execute",
        "/api/v1/opposition/execute",
        "/api/v1/setpiece-takers/execute",
        "/api/v1/set-piece/edit-execute",
        "/api/v1/player-training-menu/execute",
        "/api/v1/training-management/coach-execute",
        "/api/v1/training-management/category-execute",
        "/api/v1/training-week-edit/copy-execute",
        "/api/v1/training-week-edit/paste-execute",
        "/api/v1/training-week-edit/execute",
        "/api/v1/contracts/open-draft",
        "/api/v1/transfers/open-draft",
        "/api/v1/transfers/negotiation/execute",
        // Contract and pre-contract-promise negotiations share the same handler as the
        // validated transfer negotiation route; the route was missing from this build's
        // allow-list, which blocked the contract "confirm agreement" action.
        "/api/v1/negotiations/execute",
        "/api/v1/commands/stage-budget-allocation",
        "/api/v1/commands/confirm-budget-allocation",
        "/api/v1/commands/pick-player",
        "/api/v1/match/stage-continue",
        "/api/v1/match/set-playing",
        "/api/v1/match/begin-draft",
        "/api/v1/match/draft",
        "/api/v1/match/substitution-register",
        "/api/v1/match/substitution-phase",
        "/api/v1/match/substitution-baseline",
        "/api/v1/match/substitution-observe",
        // 0.122 batch: previously implemented write routes that were blocked only by this
        // allow-list. Match-flow writes stay out (in-match operations are read-only by policy);
        // reads and previews never need an entry here.
        "/api/v1/actions/execute",
        "/api/v1/administration/responsibility-execute",
        "/api/v1/board/request-execute",
        "/api/v1/budget-adjustment/execute",
        "/api/v1/captaincy/execute",
        "/api/v1/club-affiliate/execute",
        "/api/v1/club-vision/execute",
        "/api/v1/code-of-conduct/execute",
        "/api/v1/communication/execute",
        "/api/v1/contracts/execute",
        "/api/v1/contracts/promises/execute",
        "/api/v1/contracts/structure-execute",
        "/api/v1/conversations/reply",
        "/api/v1/friendlies/date-execute",
        "/api/v1/friendlies/execute",
        "/api/v1/friendlies/selection-execute",
        "/api/v1/match-preparation/session-confirm-execute",
        "/api/v1/medical/execute",
        "/api/v1/news/mark-all-read",
        "/api/v1/player-availability/execute",
        "/api/v1/player-management/execute",
        "/api/v1/player-side/assistant-training-execute",
        "/api/v1/player-side/discard-agent-offer-execute",
        "/api/v1/recruitment/area-execute",
        "/api/v1/recruitment/complete",
        "/api/v1/recruitment/execute",
        "/api/v1/recruitment/lifecycle-execute",
        "/api/v1/recruitment/staff-execute",
        "/api/v1/registration/player-execute",
        "/api/v1/set-piece/tactic-update-execute",
        "/api/v1/squad/captain-execute",
        "/api/v1/squad/numbers-execute",
        "/api/v1/squad/player-number-execute",
        "/api/v1/squad/registration-execute",
        "/api/v1/staff-advice/full-execute",
        "/api/v1/staff-meeting/apply-all-execute",
        "/api/v1/tactics/opposition-apply",
        "/api/v1/training-management/mentoring/create",
        "/api/v1/training-management/mentoring/execute",
        "/api/v1/training-schedule/execute",
        "/api/v1/training-schedule/confirm-execute",
        "/api/v1/training-schedule/delete-execute",
        "/api/v1/transfers/activity/execute",
        "/api/v1/transfers/date-execute",
        "/api/v1/transfers/execute",
        "/api/v1/transfers/lifecycle-execute",
        "/api/v1/transfers/structure-execute",
        "/api/v1/trades/execute",
        "/api/v1/trades/asset-execute",
        "/api/v1/trades/valuation-execute",
        "/api/v1/trades/cash-execute"
    };
    private sealed record Binary(string Path, string Sha256, long Length, long ModifiedTicks, string Error);
    private static string GameDirectory => Path.GetDirectoryName(Environment.ProcessPath) ?? ".";
    private static readonly Lazy<Binary> Observed = new(() => Inspect(Path.Combine(GameDirectory, "fm_Data", "Plugins", "x86_64", "game_plugin.dll")));
    private static readonly Lazy<Binary> ObservedManaged = new(() => Inspect(Path.Combine(GameDirectory, "GameAssembly.dll")));

    private static Binary Inspect(string path)
    {
        try
        {
            using var file = File.OpenRead(path);
            using var hash = SHA256.Create();
            var sha256 = Convert.ToHexString(hash.ComputeHash(file)).ToLowerInvariant();
            var info = new FileInfo(path);
            return new Binary(path, sha256, info.Length, info.LastWriteTimeUtc.Ticks, null);
        }
        catch (Exception error) { return new Binary(path, null, 0, 0, error.GetBaseException().Message); }
    }

    private static bool Matches(Binary binary, string expected)
    {
        if (binary.Sha256 != expected) return false;
        var info = new FileInfo(binary.Path);
        return info.Exists && info.Length == binary.Length && info.LastWriteTimeUtc.Ticks == binary.ModifiedTicks;
    }

    private static string MatchedValidationBuild(Binary native)
    {
        if (Matches(native, CurrentValidationNativeHash) && Matches(ObservedManaged.Value, CurrentValidationManagedHash))
            return CurrentValidationBuild;
        if (Matches(native, MatchValidationNativeHash) && Matches(ObservedManaged.Value, MatchValidationManagedHash))
            return MatchValidationBuild;
        return null;
    }

    private static bool MatchesValidationBuild(Binary native) => MatchedValidationBuild(native) != null;

    public static void RequireKnownProtocol(string scope = null)
    {
        var binary = Observed.Value;
        if (Matches(binary, NativeHash)) return;
        if ((scope == MatchFlowObservation || Array.Exists(MatchValidationRoutes, route => string.Equals(route, scope, StringComparison.OrdinalIgnoreCase))) &&
            MatchesValidationBuild(binary)) return;
        throw new InvalidOperationException("Player command protocol for this operation is unavailable on the installed game build. Check /api/v1/capabilities for available validation routes.");
    }
    public static object Read()
    {
        var binary = Observed.Value;
        var matches = Matches(binary, NativeHash);
        var matchedBuild = MatchedValidationBuild(binary);
        var scoped = matchedBuild != null;
        var features = new[] {
            new { id = "live_data", scope = "native_subscription", implemented = true },
            new { id = "tactic_role_formation", scope = "tactic_state", implemented = true },
            new { id = "tactic_creation", scope = "original_preset_and_two_formations_with_native_slot_count_observation", implemented = true },
            new { id = "mentality_and_instructions", scope = "tactic_state", implemented = true },
            new { id = "lineup_selection", scope = "native_squad_slots_0_to_25_draft_with_durable_receipts", implemented = true },
            new { id = "match_lineup_submission", scope = "normal_native_team_selection_2021084960_with_eligibility_and_full_lineup_guard", implemented = true },
            new { id = "set_piece_creator", scope = "normal_start_original_answers_and_post_final_creation_completion_not_full_routine_editor", implemented = true },
            new { id = "match_playback", scope = "match_playback", implemented = true },
            new { id = "match_tactical_changes", scope = "match_tactical_draft", implemented = true },
            new { id = "on_pitch_players", scope = "observed_on_pitch_players", implemented = true },
            new { id = "match_substitution_workflow", scope = "durable_parent_phases_and_validated_native_on_pitch_transition", implemented = true },
            new { id = "team_talk", scope = "native_recipients_and_offered_speech_dispatch_with_independent_state", implemented = true },
            new { id = "match_phase", scope = "read_only_managed_playback_fsm_not_native_period_acceptance", implemented = true },
            new { id = "simulation_period", scope = "read_only_native_plugin_match_interface_with_current_handle_and_identity", implemented = true },
            new { id = "request_continue_game", scope = "guarded_event13_dispatch_and_waiting_observation_not_stage_acceptance", implemented = true },
            new { id = "continue_progress_observations", scope = "persisted_baseline_and_independent_callback_managed_phase_and_native_period_changes", implemented = true },
            new { id = "match_stage_continue", scope = "native_business_prelude_and_original_current_stage_virtual_handler_with_normal_phase_view_updates", implemented = true },
            new { id = "budget_allocation", scope = "budget_draft_and_submit_dispatch", implemented = true },
            new { id = "individual_training", scope = "individual_training_configuration", implemented = true },
            new { id = "team_week_schedule", scope = "native_week_schedule_dispatch_and_independent_observation", implemented = true },
            new { id = "team_training_session", scope = "same_date_and_slot_configuration", implemented = true },
            new { id = "general_training_control", scope = "native_this_once_or_all_with_training_operation", implemented = true },
            new { id = "staff_responsibilities", scope = "native_individual_take_delegate_and_group_take_recommended_dispatch", implemented = true },
            new { id = "captain_selection", scope = "current_team_original_doaction_menu_dispatch", implemented = true },
            new { id = "squad_number_draft", scope = "normal_auto_clear_revert_edit_session", implemented = true },
            new { id = "individual_squad_number", scope = "original_dropdown_choice_and_player_context_number_draft", implemented = true },
            new { id = "squad_registration", scope = "native_auto_clear_revert_and_confirm_registration_dispatch", implemented = true },
            new { id = "board_requests", scope = "current_club_original_board_request_dropdown_business_dispatch", implemented = true },
            new { id = "registration_player_selection", scope = "original_candidate_and_person_context_checkbox_draft", implemented = true },
            new { id = "friendly_opponent_rules", scope = "original_dropdown_record_normal_business_dispatch", implemented = true },
            new { id = "medical_reports", scope = "game_offered_physio_and_injury_risk_report_request_dispatch", implemented = true },
            new { id = "inbox_mark_all_read", scope = "native_human_team_command_and_independent_unread_count", implemented = true },
            new { id = "coach_assignments", scope = "normal_assistant_assign_and_clear_dispatch", implemented = true },
            new { id = "individual_coach_categories", scope = "original_category_EventData_assign_unassign_for_nine_categories", implemented = true },
            new { id = "person_management_menus", scope = "31_explicit_normal_game_offered_DoAction_menu_families_dispatch_only", implemented = true },
            new { id = "player_availability", scope = "owned_player_normal_squad_and_reserves_availability_menu_dispatch", implemented = true },
            new { id = "touchline_shouts", scope = "normal_native_shout_and_original_group_selection_dispatch", implemented = true },
            new { id = "opposition_instructions", scope = "five_normal_instruction_choices_with_actual_opponent_fixture_and_row_context", implemented = true },
            new { id = "set_piece_takers", scope = "original_candidate_left_right_both_foot_add_and_native_penalty_quick_pick", implemented = true },
            new { id = "conversation_replies", scope = "existing_person_team_conversation_original_shared_speakto_bucket_business_actions", implemented = true },
            new { id = "mentoring_groups", scope = "normal_create_original_candidate_selection_group_edit_confirm_rename_delete_dispatch", implemented = true },
            new { id = "training_unit_summaries", scope = "read_only_four_native_unit_summaries_not_player_regrouping", implemented = true },
            new { id = "training_rest_menus", scope = "normal_training_report_rest_cancel_rest_menu_business_dispatch", implemented = true },
            new { id = "friendly_dates", scope = "original_available_GameDate_list_and_draft_date_binding", implemented = true },
            new { id = "friendly_arrangement", scope = "normal_venue_and_valid_draft_confirm_cancel_dispatch_not_full_creation_workflow", implemented = true },
            new { id = "transfer_proposal_exchange", scope = "normal_exchange_selection_and_proposal_exclusions_draft", implemented = true },
            new { id = "communication_actions", scope = "offered_shared_speakto_simple_business_leaf_dispatch_only", implemented = true },
            new { id = "recruitment_focus", scope = "recovered_filters_areas_staff_selection_draft_and_submit_cancel_dispatch", implemented = true },
            new { id = "recruitment_focus_lifecycle", scope = "existing_focus_complete_restart_delete_normal_dispatch", implemented = true },
            new { id = "player_action_menu", scope = "six_actions_dispatch_only", implemented = true },
            new { id = "precontract_promises", scope = "normal_playing_time_promises_future_time_and_lock_draft_and_offered_negotiation_dispatch", implemented = true },
            new { id = "contract_terms", scope = "contract_dates_status_and_cash_draft", implemented = true },
            new { id = "contract_draft_opening", scope = "offered_contract_menu_with_explicit_native_session_initialization", implemented = true },
            new { id = "contract_structure", scope = "native_bonus_clause_add_remove_numeric_lock_cash_steps_reset_existing_draft", implemented = true },
            new { id = "transfer_activity_responses", scope = "owned_club_transfer_and_trade_offer_actual_permission_native_response_dispatch", implemented = true },
            new { id = "transfer_terms", scope = "existing_offer_clause_draft", implemented = true },
            new { id = "transfer_draft_opening", scope = "current_buying_club_offer_permission_and_native_draft_initialization", implemented = true },
            new { id = "transfer_structure", scope = "add_remove_dispatch_and_offer_type_draft", implemented = true },
            new { id = "negotiation_actions", scope = "game_offered_action_dispatch_only", implemented = true },
            new { id = "news_responses", scope = "native_response_dispatch_and_independent_state_observation", implemented = true },
            new { id = "inbox", scope = "read_only", implemented = true },
            new { id = "save_load", scope = "legacy_function_calls", implemented = true }
        };
        return new { ok = true, schemaVersion = 2, pluginVersion = Plugin.Version, fullVersionComplete = false,
            sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            security = new {
                authRequired = AuthGuard.AuthRequired,
                devMode = AuthGuard.IsDevMode,
                productionAllowlistActive = !AuthGuard.IsDevMode
            },
            protocol = new { referenceSteamBuild = ProtocolBuild, expectedNativeSha256 = NativeHash, observedNativeSha256 = binary.Sha256,
                source = "installed_binary_on_disk", binaryOnDiskMatches = matches, error = binary.Error,
                scopedBuild = matchedBuild, scopedCommandRoutes = scoped ? MatchValidationRoutes : Array.Empty<string>(),
                scopedMatchFlowObservation = scoped, observedManagedSha256 = ObservedManaged.IsValueCreated ? ObservedManaged.Value.Sha256 : null },
            mainThread = MainThreadDriver.ReadHeartbeat(),
            features,
            currentBuildLiveGameplayVerified = true,
            liveVerifiedWorkflows = new[] {
                "live_query_and_describe",
                "tactics_mentality_style_instructions_roles_formation",
                "set_piece_takers_add_move_remove",
                "opposition_instructions",
                "live_match_team_stats_and_xg_39_metrics",
                "global_player_search_and_scouting_pool_filter",
                "shortlists_and_recruitment_focus_submit",
                "transfer_offer_draft_cash_staging_submit_and_accept_incoming_bid",
                "own_player_contract_renewal_submission",
                "transfer_and_loan_listing",
                "training_schedules_intensity_individual_and_mentoring_create",
                "inbox_mark_all_read_and_guarded_continue_game"
            },
            knownBoundaries = new[] {
                "external_player_contract_final_confirmation_requires_in_game_contract_panel",
                "in_match_mutations_and_press_conference_answers_gated_in_assistant_mode"
            },
            clientMutationObserver = new { hooksInstalled = MutationActivity.HooksReady, cursor = MutationActivity.Cursor,
                scope = "observed_managed_gameinterop_client_requests_only", nativeTransactionLock = false },
            continuationCallbackObserver = new { hooksInstalled = ContinueCallbackLog.HooksReady, cursor = ContinueCallbackLog.Cursor,
                scope = "actual_match_controller_handler_prefix_and_finalizer_not_native_acceptance_attestation" },
            commandRules = new { noUiInput = true, expectedStateRequired = true,
                dispatchAloneIsSuccess = false, unknownResultAutoRetry = false } };
    }
}
