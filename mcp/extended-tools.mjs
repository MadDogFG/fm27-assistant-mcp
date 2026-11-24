import { createTacticSlotTools } from "./tactic-slot-tools.mjs";
import { createInductionTools } from "./induction-tools.mjs";
import { createLineupSubmissionTools } from "./lineup-submission-tools.mjs";
import { createSetPieceCreatorTools } from "./setpiece-creator-tools.mjs";
import { createOppositionTools } from "./opposition-tools.mjs";
import { createSetPieceTakerTools } from "./set-piece-taker-tools.mjs";
import { createSetPieceEditTools } from "./set-piece-edit-tools.mjs";
import { createConversationReplyTools } from "./conversation-reply-tools.mjs";
import { createMentoringTools } from "./mentoring-tools.mjs";
import { createPlayerManagementTools } from "./player-management-tools.mjs";
import { createTransferActivityTools } from "./transfer-activity-tools.mjs";
import { createPreContractTools } from "./precontract-tools.mjs";
import { createTradeOfferTools } from "./trade-tools.mjs";
import { createTrainingScheduleTools } from "./training-schedule-tools.mjs";
import { createTeamTrainingIntensityTools } from "./team-training-intensity-tools.mjs";
import { createClubAffiliateTools } from "./club-affiliate-tools.mjs";
import { createClubOverviewTools } from "./club-overview-tools.mjs";
import { createWorldAndSquadTools } from "./world-and-squad-tools.mjs";
import { createMatchAnalyticsTools } from "./match-analytics-tools.mjs";
import { createPlayerAndScoutingInsightsTools } from "./player-and-scouting-insights-tools.mjs";
import { createShortlistManagementTools } from "./shortlist-management-tools.mjs";
import { createOppositionReportTools } from "./opposition-report-tools.mjs";
import { createSeasonAndInternationalTools } from "./season-and-international-tools.mjs";
import { createCompetitionsAndAwardsTools } from "./competitions-and-awards-tools.mjs";
import { createPlayerComparisonTools } from "./player-comparison-tools.mjs";
import { createDatahubAndTransferRoomTools } from "./datahub-and-transfer-room-tools.mjs";
import { createSquadPlannerTools } from "./squad-planner-tools.mjs";
import { createJobAdvertTools } from "./job-advert-tools.mjs";
import { createPastMatchReportTools } from "./past-match-report-tools.mjs";
import { createCupDrawAndLeagueTools } from "./cup-draw-and-league-tools.mjs";
import { createYouthAndMedicalTools } from "./youth-and-medical-tools.mjs";
import { createDofAndFollowTools } from "./dof-and-follow-tools.mjs";
import { createManagerHolidayTools } from "./manager-holiday-tools.mjs";
import { createPlayerSearchFilterTools } from "./player-search-filter-tools.mjs";
import { createDevelopmentAdviceTools } from "./development-advice-tools.mjs";
import { createWorkPermitAndTrialTools } from "./work-permit-and-trial-tools.mjs";
import { createInternationalManagementTools } from "./international-management-tools.mjs";
import { createMlsAndNegotiationAdviceTools } from "./mls-and-negotiation-advice-tools.mjs";
import { createManagerCareerTools } from "./manager-career-tools.mjs";
import { createInboxFlagsAndPromisesTools } from "./inbox-flags-and-promises-tools.mjs";
import { createClubVisionTools } from "./club-vision-tools.mjs";
import { createClubStateTools } from "./club-state-tools.mjs";
import { createCaptaincyStandinTools } from "./captaincy-standin-tools.mjs";
import { createCodeOfConductTools } from "./code-of-conduct-tools.mjs";
import { createBudgetAdjustmentTools } from "./budget-adjustment-tools.mjs";
import { createSquadSnapshotTools } from "./squad-snapshot-tools.mjs";
import { createBestXiTools } from "./algorithms/best-xi.mjs";
import { createSquadAuditTools } from "./algorithms/squad-audit.mjs";
import { createLiveQueryTools } from "./live-query-tools.mjs";
import { createPlayerAttributesTools } from "./player-attributes-tools.mjs";
import { createTeamSelectionTools } from "./team-selection-tools.mjs";
import { createTacticSuggestionTools } from "./tactic-suggestion-tools.mjs";
import { createTacticAnalysisTools } from "./tactic-analysis-tools.mjs";
import { createStaffAdviceTools } from "./staff-advice-tools.mjs";
import { createSetPieceRoutineTools } from "./set-piece-routine-tools.mjs";
import { createMatchPreparationTools } from "./match-preparation-tools.mjs";
import { createStaffMeetingTools } from "./staff-meeting-tools.mjs";
import { createOppositionAdviceTools } from "./opposition-advice-tools.mjs";
import { createTacticChangeTools } from "./tactic-change-tools.mjs";
import { createPlayerSideTools } from "./player-side-tools.mjs";
import { createTrainingWeekEditTools } from "./training-week-edit-tools.mjs";
import { createMatchShoutTools } from "./match-shout-tools.mjs";
import { createTrainingUnitTools } from "./training-unit-tools.mjs";
import { createPlayerTools } from "./player-tools.mjs";
import { createManagerTools } from "./manager-tools.mjs";
import { createActionTools } from "./action-tools.mjs";
import { createTrainingTools } from "./training-tools.mjs";
import { createTrainingStateTools } from "./training-state-tools.mjs";
import { createMatchTools } from "./match-tools.mjs";
import { createMatchReadTools } from "./match-read-tools.mjs";
import { createPanelStateTools } from "./panel-state-tools.mjs";
import { createContractTools } from "./contract-tools.mjs";
import { createNegotiationTools } from "./negotiation-tools.mjs";
import { createTransferTools } from "./transfer-tools.mjs";
import { createTransferStructureTools } from "./transfer-structure-tools.mjs";
import { createNewsTools } from "./news-tools.mjs";
import { createTeamScheduleTools } from "./team-schedule-tools.mjs";
import { createTeamSessionTools } from "./team-session-tools.mjs";
import { createRecruitmentTools } from "./recruitment-tools.mjs";
import { createSubstitutionTools } from "./substitution-tools.mjs";
import { createTeamTalkTools } from "./team-talk-tools.mjs";
import { createContinueTools } from "./continue-tools.mjs";
import { createMatchStageTools } from "./match-stage-tools.mjs";
import { createTrainingBatchTools } from "./training-batch-tools.mjs";
import { createAdministrationTools } from "./administration-tools.mjs";
import { createContractStructureTools } from "./contract-structure-tools.mjs";
import { createSquadAdministrationTools } from "./squad-administration-tools.mjs";
import { createNegotiationLifecycleTools } from "./negotiation-lifecycle-tools.mjs";
import { createCommunicationTools } from "./communication-tools.mjs";
import { createRecruitmentLifecycleTools } from "./recruitment-lifecycle-tools.mjs";
import { createBoardRequestTools } from "./board-request-tools.mjs";
import { createFriendlyTools } from "./friendly-tools.mjs";
import { createRegistrationSelectionTools } from "./registration-selection-tools.mjs";
import { createClubBusinessTools } from "./club-business-tools.mjs";
import { createInboxManagementTools } from "./inbox-management-tools.mjs";
import { createMedicalTools } from "./medical-tools.mjs";
import { createTrainingManagementTools } from "./training-management-tools.mjs";
import { createPlayerAvailabilityTools } from "./player-availability-tools.mjs";
import { createPlayerTrainingMenuTools } from "./player-training-menu-tools.mjs";

const text = { type: "string" };
const operation = { operationId: text, expected: text };
const slot = { selectionIndex: { type: "integer", minimum: 0, maximum: 10 }, inPossession: { type: "boolean", default: true } };
const lineupSlot = { type: "integer", minimum: 0, maximum: 25 };
const mutationCursor = { type: "integer", minimum: 0 };
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const experimental = "";
const trainingDelegation = { type: "string", enum: ["respect", "take_control_this_once", "take_control_all"], default: "respect" };
export function createExtendedTools(call) {
  const player = createPlayerTools(call), manager = createManagerTools(call), actions = createActionTools(call), training = createTrainingTools(call);
  const match = createMatchTools(call), matchRead = createMatchReadTools(call, match.state), panelState = createPanelStateTools(call);
  const clubOverview = createClubOverviewTools(call);
  const worldAndSquad = createWorldAndSquadTools(call);
  const contracts = createContractTools(call);
  const negotiations = createNegotiationTools(call);
  const transfers = createTransferTools(call);
  const structure = createTransferStructureTools(call);
  const news = createNewsTools(call);
  const teamSchedule = createTeamScheduleTools(call);
  const teamSession = createTeamSessionTools(call);
  const recruitment = createRecruitmentTools(call);
  const substitution = createSubstitutionTools(call);
  const teamTalk = createTeamTalkTools(call);
  const continuation = createContinueTools(call);
  const stage = createMatchStageTools(call);
  const matchAnalytics = createMatchAnalyticsTools(call);
  const playerScouting = createPlayerAndScoutingInsightsTools(call);
  const shortlists = createShortlistManagementTools(call);
  const oppositionReport = createOppositionReportTools(call);
  const seasonIntl = createSeasonAndInternationalTools(call);
  const compAwards = createCompetitionsAndAwardsTools(call);
  const playerComparison = createPlayerComparisonTools(call);
  const squadSnapshot = createSquadSnapshotTools(call);
  const bestXi = createBestXiTools(call);
  const squadAudit = createSquadAuditTools(call);
  const liveQuery = createLiveQueryTools(call);
  const playerAttrs = createPlayerAttributesTools(call);
  const datahubTr = createDatahubAndTransferRoomTools(call);
  const squadPlanner = createSquadPlannerTools(call);
  const jobAdverts = createJobAdvertTools(call);
  const pastMatchReport = createPastMatchReportTools(call);
  const cupDrawLeague = createCupDrawAndLeagueTools(call);
  const youthMedical = createYouthAndMedicalTools(call);
  const dofFollow = createDofAndFollowTools(call);
  const managerHoliday = createManagerHolidayTools(call);
  const playerSearchFilter = createPlayerSearchFilterTools(call);
  const developmentAdvice = createDevelopmentAdviceTools(call);
  const workPermitTrial = createWorkPermitAndTrialTools(call);
  const intlMgmt = createInternationalManagementTools(call);
  const mlsAdvice = createMlsAndNegotiationAdviceTools(call);
  const managerCareer = createManagerCareerTools(call);
  const inboxFlagsPromises = createInboxFlagsAndPromisesTools(call);
  const trainingBatch = createTrainingBatchTools(call);
  const administration = createAdministrationTools(call);
  const contractStructure = createContractStructureTools(call);
  const squad = createSquadAdministrationTools(call), proposal = createNegotiationLifecycleTools(call), communication = createCommunicationTools(call);
  const focusLifecycle = createRecruitmentLifecycleTools(call);
  const board = createBoardRequestTools(call);
  const friendly = createFriendlyTools(call);
  const registrationSelection = createRegistrationSelectionTools(call), friendlySelection = createClubBusinessTools(call);
  const inboxManagement = createInboxManagementTools(call), medical = createMedicalTools(call);
  const trainingManagement = createTrainingManagementTools(call);
  const availability = createPlayerAvailabilityTools(call);
  const playerTrainingMenu = createPlayerTrainingMenuTools(call);
  const shouts = createMatchShoutTools(call), trainingUnits = createTrainingUnitTools(call), trainingState = createTrainingStateTools(call);
  const shoutArgs = { kind: { type: "string", enum: ["shout", "group"], default: "shout" }, optionIndex: { type: "integer", minimum: 0, description: "shout: native candidate index; group: original value 4,1,2,3 from get_match_shouts" }, expectedChoiceToken: text, operationId: text };
  const trainingMenuArgs = { source: text, path: text, squadIndex: { type: "integer", minimum: 0 }, action: { type: "string", enum: ["training_report", "rest", "cancel_rest", "weaker_foot", "leadership_course", "language_course", "preferred_move"] }, acceptConfirmation: { type: "boolean", default: false },
    entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 }, expectedChoiceToken: text, operationId: text };
  const availabilityArgs = { source: text, path: text, action: { type: "string", enum: ["PersonChangePlayersClubSquad", "PersonMakePlayersAvailableForReserves", "1516726887", "1245135978"] },
    entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 }, expectedChoiceToken: text, operationId: text, acceptConfirmation: { type: "boolean", default: false } };
  const coachCategoryArgs = { coachPath: text, category: { type: "string", enum: ["AttackingTacticalCategory", "AttackingTechnicalCategory", "DefendingTacticalCategory", "DefendingTechnicalCategory", "PossessionTacticalCategory", "PossessionTechnicalCategory", "GoalkeepingCategory", "FitnessCategory", "SetPiecesCategory"] }, assigned: { type: "boolean" }, expectedChoiceToken: text, operationId: text };
  const coachArgs = { operation: { type: "string", enum: ["assistant_assign", "clear"] }, expectedChoiceToken: text, operationId: text };
  const friendlyDateArgs = { dateIndex: { type: "integer", minimum: 0 }, contexts: { type: "object" }, expectedChoiceToken: text, operationId: text };
  const medicalArgs = { source: text, path: text, action: { type: "string", enum: ["physio_report", "injury_risk_update"] },
    entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 }, expectedChoiceToken: text, operationId: text };
  const registrationPlayer = { personPath: text, selected: { type: "boolean" }, expectedChoiceToken: text, operationId: text, contexts: { type: "object" }, squadSelectionRule: { type: "integer", minimum: 0 } };
  const friendlySelectionArgs = { kind: { type: "string", enum: ["opponent", "rules"] }, optionPath: text, contexts: { type: "object" }, expectedChoiceToken: text, operationId: text };
  const friendlyArgs = { operation: { type: "string", enum: ["home", "away", "confirm", "cancel"] }, contexts: { type: "object" }, expectedChoiceToken: text, operationId: text };
  const playerNumberArgs = { playerPath: text, optionPath: text, expectedChoiceToken: text, operationId: text };
  const registrationArgs = { operation: { type: "string", enum: ["auto", "clear", "revert", "confirm"] },
    contexts: { type: "object" }, squadSelectionRule: { type: "integer", minimum: 0 }, expectedChoiceToken: text, operationId: text };
  const boardArgs = { optionPath: text, expectedChoiceToken: text, operationId: text, acceptConfirmation: { type: "boolean", default: false } };
  const focusLifeArgs = { focusPath: text, action: { type: "string", enum: ["restart", "complete", "delete"] }, expectedChoiceToken: text,
    acceptConfirmation: { type: "boolean", default: false }, operationId: text };
  const captainArgs = { kind: { type: "string", enum: ["captain", "vice_captain"] }, entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 }, expectedChoiceToken: text, operationId: text };
  const numbersArgs = { operation: { type: "string", enum: ["auto", "clear", "revert", "confirm"] }, expectedChoiceToken: text, operationId: text };
  const proposalArgs = { source: text, path: text, buyingClubSource: text, buyingClubPath: text,
    kind: { type: "string", enum: ["exchange-player", "exclude-rivals", "exclude-overseas", "exclude-domestic", "exclude-non-top-division"] },
    playerPath: text, selected: { type: "boolean" }, expectedChoiceToken: text, operationId: text };
  const transferDateArgs = { source: text, path: text, buyingClubSource: text, buyingClubPath: text,
    kind: { type: "string", enum: ["start-date", "end-date"] }, collection: text, clausePath: text,
    dateSource: text, datePath: text, expectedChoiceToken: text, operationId: text };
  const communicationArgs = { source: text, path: text, contexts: { type: "object" },
    bucket: { type: "string", enum: ["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"] }, actionIndex: { type: "integer", minimum: 0 },
    expectedChoiceToken: text, operationId: text, acceptConfirmation: { type: "boolean", default: false } };
  const squadIdx = { type: "integer", minimum: 0, description: "本队一线队球员序号（可替代 source，来自 get_squad_snapshot）" };
  const contractComponent = { source: text, path: text, squadIndex: squadIdx, action: { type: "string", enum: ["add-bonus", "add-clause", "remove-addon", "numeric", "lock", "cash-increase", "cash-decrease", "reset", "use-existing"] },
    collection: { type: "string", enum: ["AddOnList", "BonusesList", "ClausesList"] }, componentPath: text, optionPath: text, expectedChoiceToken: text, operationId: text };
  const responsibility = { tabPath: text, groupPath: text, responsibilityPath: text,
    action: { type: "string", enum: ["take_control", "delegate", "group_take_control", "group_recommended"] }, expectedChoiceToken: text, operationId: text };
  const batchPlayer = { type: "object", properties: { source: text, path: text,
    kind: { type: "string", enum: ["intensity", "focus", "position-role", "oop-role"] }, roleIndex: { type: "integer", minimum: 0 }, optionIndex: { type: "integer", minimum: 0 },
    expectedCurrent: text, expectedChoiceToken: text, operationId: text,
    delegation: { type: "string", enum: ["respect", "take_control_this_player"], default: "respect" } }, required: ["source", "kind"], additionalProperties: false };
  const focusSource = { mode: { type: "string", enum: ["new", "existing"], default: "new" }, focusPath: text };
  const focusStaff = { ...focusSource, kind: { type: "string", enum: ["scouts", "analysts"] }, selection: { type: "string", enum: ["any", "explicit"] }, personPaths: { type: "array", items: text } };
  const focusSetting = { ...focusSource, kind: { type: "string", enum: ["min-age", "max-age", "name", "include-scouted", "undeclared-players", "priority", "any-position", "position", "ip-role", "oop-role", "current-ability-threshold", "potential-ability-threshold", "ip-role-proficiency", "oop-role-proficiency"] }, optionIndex: { type: "integer", minimum: 0 }, optionPath: text, input: text };
  const shoutPlayers = { playerIndices: { type: "array", items: { type: "integer", minimum: 0 }, maxItems: 32, uniqueItems: true }, expectedChoiceToken: text, operationId: text };
  const induction = createInductionTools(call);
  const lineupSubmission = createLineupSubmissionTools(call);
  const setPieceCreator = createSetPieceCreatorTools(call);
  const creatorArgs = { action: { type: "string", enum: ["start", "next", "finish"] }, optionPath: text, expectedChoiceToken: text, operationId: text };
  const inductionArgs = { index: { type: "integer", minimum: 0 }, expectedNewsIdentity: text,
    actionIndex: { type: "integer", minimum: 0 }, expectedChoiceToken: text, operationId: text,
    acceptConfirmation: { type: "boolean", default: false } };
  const precontract = createPreContractTools(call);
  const trades = createTradeOfferTools(call);
  const trainingSchedule = createTrainingScheduleTools(call);
  const teamIntensity = createTeamTrainingIntensityTools(call);
  const clubAffiliate = createClubAffiliateTools(call);
  const clubVision = createClubVisionTools(call), clubState = createClubStateTools(call);
  const captaincy = createCaptaincyStandinTools(call);
  const codeOfConduct = createCodeOfConductTools(call);
  const budgetAdjustment = createBudgetAdjustmentTools(call);
  const teamSelection = createTeamSelectionTools(call);
  const tacticSuggestion = createTacticSuggestionTools(call);
  const tacticAnalysis = createTacticAnalysisTools(call);
  const staffAdvice = createStaffAdviceTools(call);
  const setPieceRoutine = createSetPieceRoutineTools(call);
  const matchPreparation = createMatchPreparationTools(call);
  const staffMeeting = createStaffMeetingTools(call);
  const oppositionAdvice = createOppositionAdviceTools(call);
  const tacticChange = createTacticChangeTools(call);
  const tacticChangeArgs = { action: { type: "string", enum: ["next-match-only", "cancel", "confirm"] }, value: { type: "boolean" }, expectedChoiceToken: text, operationId: text };
  const oppositionAdviceArgs = { expectedChoiceToken: text, operationId: text };
  const staffMeetingArgs = { expectedChoiceToken: text, operationId: text };
  const matchPreparationArgs = { sessionIndex: { type: "number" }, expectedChoiceToken: text, operationId: text };
  const setPieceRoutineArgs = { expectedChoiceToken: text, operationId: text };
  const staffAdviceArgs = { expectedChoiceToken: text, operationId: text };
  const tacticSuggestionArgs = { kind: { type: "string", enum: ["team", "changes"] }, expectedChoiceToken: text, operationId: text };
  const playerSide = createPlayerSideTools(call);
  const trainingWeekEdit = createTrainingWeekEditTools(call);
  const trainingWeekEditArgs = { action: { type: "string", enum: ["commit", "cancel"] }, expectedChoiceToken: text, operationId: text };
  const trainingWeekCopyArgs = { weekIndex: { type: "number" }, expectedChoiceToken: text, operationId: text };
  const playerSideArgs = { source: text, path: text, all: { type: "boolean", default: false }, expectedChoiceToken: text, operationId: text };
  const teamSelectionArgs = { expectedChoiceToken: text, operationId: text, optionPath: text };
  const budgetAdjustmentArgs = { action: text, expectedChoiceToken: text, operationId: text };
  const codeOfConductArgs = { finePath: text, action: { type: "string", enum: ["increment", "decrement", "change"] }, optionPath: text, expectedChoiceToken: text, operationId: text };
  const captaincyArgs = { source: text, path: text, optionPath: text, expectedChoiceToken: text, operationId: text };
  const clubVisionArgs = { action: { type: "string", enum: ["add-objective", "remove-objective", "undo", "revert", "suggest", "confirm"] }, optionPath: text, objectivesKind: { type: "string", enum: ["actionable", "year"] }, objectivePath: text, expectedChoiceToken: text, operationId: text };
  const clubAffiliateArgs = { action: { type: "string", enum: ["select-index", "propose", "cancel-proposal"] }, index: { type: "integer", minimum: 0 }, expectedChoiceToken: text, operationId: text };
  const teamIntensityArgs = { conditionRange: { type: "integer", minimum: 0, maximum: 4 }, optionPath: text, expectedChoiceToken: text, operationId: text };
  const trainingScheduleArgs = { action: { type: "string", enum: ["begin", "save", "clear", "create", "confirm", "delete"] }, name: text, monthPath: text, weekPath: text, categoryPath: text, optionPath: text, expectedChoiceToken: text, operationId: text };
  const tradeArgs = { offerIndex: { type: "integer", minimum: 0 }, action: { type: "string", enum: ["add-human", "add-other", "remove-human", "remove-other", "set-negotiable", "change-asset", "request-dof-valuation", "input-cash"] }, assetSide: { type: "string", enum: ["human", "other"], default: "human" }, assetIndex: { type: "integer", minimum: 0 }, cashKind: { type: "string", enum: ["minimum", "dof"] }, cash: text, optionPath: text, assetPath: text, expectedChoiceToken: text, operationId: text };
  const precontractArgs = { source: text, path: text, action: { type: "string", enum: ["agreed-playing-time", "agreed-playing-time-lock", "start-date", "start-date-lock", "overall-lock", "add-promise", "promise-linked-value", "promise-lock", "remove-promise", "future-playing-time", "future-playing-time-lock", "future-target-type", "future-target-choice", "remove-future-playing-time", "clear-future-target", "future-target-value", "reset"] }, componentPath: text, optionPath: text, value: text, expectedChoiceToken: text, operationId: text };
  const activity = createTransferActivityTools(call);
  const activityArgs = { kind: { type: "string", enum: ["players", "staff", "trades"], default: "players" }, direction: { type: "string", enum: ["all", "in", "out"], default: "all" }, personPath: text, offerPath: text, action: { type: "string", enum: ["accept", "stall", "cancel-reject-withdraw"] }, expectedChoiceToken: text, operationId: text };
  const personManagement = createPlayerManagementTools(call);
  const managementArgs = { source: text, path: text, squadIndex: { type: "integer", minimum: 0 }, action: text, entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 }, expectedChoiceToken: text, operationId: text, acceptConfirmation: { type: "boolean", default: false } };
  const mentoring = createMentoringTools(call);
  const mentoringArgs = { mode: { type: "string", enum: ["existing", "new"], default: "existing" }, groupPath: text, action: { type: "string", enum: ["create", "initialize", "delete", "clear", "revert", "auto-select", "select-players", "confirm", "rename"] }, playerIndices: { type: "array", items: { type: "integer", minimum: 0 }, uniqueItems: true }, name: text, expectedChoiceToken: text, operationId: text };
  const takers = createSetPieceTakerTools(call), conversationReplies = createConversationReplyTools(call), setPieceEdit = createSetPieceEditTools(call);
  const takerArgs = { action: { type: "string", enum: ["add-left", "add-right", "add-both", "penalty-quick-pick", "remove", "penalty-add", "penalty-remove", "penalty-move", "move"] }, destination: { type: "integer", minimum: 0 }, playerPaths: { type: "array", items: text, maxItems: 100, uniqueItems: true }, contexts: { type: "object", additionalProperties: true }, setPieceType: { type: "integer", minimum: 0 }, setPiecePitchSide: { type: "integer", minimum: 0 }, setPieceScenario: { type: "integer", minimum: 0 }, expectedChoiceToken: text, operationId: text };
  const setPieceEditArgs = { action: { type: "string", enum: ["option", "begin", "end", "cancel"] }, properties: { type: "array", items: text }, property: text, optionsProperty: text, optionPath: text, contexts: { type: "object", additionalProperties: true }, setPieceType: { type: "integer", minimum: 0 }, setPiecePitchSide: { type: "integer", minimum: 0 }, setPieceScenario: { type: "integer", minimum: 0 }, expectedChoiceToken: text, operationId: text };
  const conversationArgs = { source: text, path: text, bucket: { type: "string", enum: ["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"] }, actionIndex: { type: "integer", minimum: 0 }, expectedChoiceToken: text, acceptConfirmation: { type: "boolean", default: false }, operationId: text };
  const opposition = createOppositionTools(call);
  const oppositionArgs = { mode: { type: "string", enum: ["players", "positions"], default: "players" }, rowPath: text, kind: { type: "string", enum: ["marking", "pressing", "tackling", "show-foot", "personalised"] }, optionPath: text, expectedChoiceToken: text, operationId: text };
  const tacticSlots = createTacticSlotTools(call);
  const slotArgs = { scope: {type:"string",enum:["team","current"],default:"team"}, action:{type:"string",enum:["select","training"]}, slotIndex:{type:"integer",minimum:0}, expectedChoiceToken:text,operationId:text };
  const tacticMenuArgs = { menuKind:{type:"string",enum:["add","modify"],default:"modify"}, optionPath:text, expectedChoiceToken:text, operationId:text, acceptDelete:{type:"boolean",default:false} };
  const tacticCreationArgs = { tacticalStyle: { type: "integer", minimum: 0 }, inPossessionFormation: { type: "integer", minimum: 1 },
    outOfPossessionFormation: { type: "integer", minimum: 1 }, expectedChoiceToken: text, operationId: text };
  const definitions = [
    ["get_tactic_creation", "读取球队当前空槽及原生创建选项。提供风格、持球阵型、无球阵型 ID 即可预览一次创建。", tacticCreationArgs, [], tacticSlots.creation],
    ["set_tactical_style", "一键读取或切换当前战术的官方预设风格（控制球权/高位压迫/密集短传/双翼齐飞/长传冲吊/灵活防反/快速防反/链式防守/摆大巴等），不传 style 则只读返回全部可选风格与本队推荐 TOP3；传入风格 ID 或中英文名则直接切换并同步预设球队指令，独立读回验证。", { style: { description: "目标战术风格 ID（0-10）或中英文名称（如 '高位压迫'、'快速防反'、'gegenpress'）；不传则只读查询" }, previewOnly: { type: "boolean", default: false } }, [], tacticSlots.setStyle],
    ["create_tactic", "提交预览过的风格及两种阵型，调用游戏原生创建，新战术使用游戏分配的空槽。槽数增加由独立订阅读回。", tacticCreationArgs,
      ["tacticalStyle", "inPossessionFormation", "outOfPossessionFormation", "expectedChoiceToken", "operationId"], tacticSlots.create],
    ["list_tactic_files", "从游戏实际的 AddOnsList 读取默认保存方式下的战术文件候选。", {}, [], tacticSlots.files],
    ["save_tactic_file", "按原生文件保存流程将当前球队战术槽另存为新文件。先提供名称和 UUID 预览，再提供 token 派发；回执不证明已经写盘。", { name: text, operationId: text, expectedChoiceToken: text }, ["name", "operationId"], tacticSlots.saveFile],
    ["get_tactic_management_options", "读取实际战术菜单的复制/删除候选，指定optionPath预览。", tacticMenuArgs, [], tacticSlots.menu],
    ["manage_tactic_slot", "复制当前战术到可用槽，或按原菜单确认删除当前战术。保留槽数/禁用规则与原始payload，删除需acceptDelete；不操作UI。", tacticMenuArgs,["optionPath","expectedChoiceToken","operationId"],tacticSlots.manage],
    ["get_tactic_slots", "读取游戏提供的战术槽的实际名称、有效性、当前槽和主训练战术；带action/slotIndex预览切换或主训练选择。", slotArgs, [], tacticSlots.get],
    ["select_tactic_slot", "通过游戏原生选槽事件切换已有战术，或设置主训练战术；保留真实槽位、预览token、临场草稿门槛，独立读回。", slotArgs,["action","slotIndex","expectedChoiceToken","operationId"],tacticSlots.execute],
    ["get_opposition_instructions", "读取真实下一对手的球员/位置针对性指令及合法选项：盯防、逼抢、铲抢、逼某只脚和个性化开关。选rowPath/kind读候选，再选optionPath预览；personalised用true/false。", oppositionArgs, [], opposition.get],
    ["set_opposition_instruction", "按实际对手/比赛来源与原生候选设置针对性指令，绑定真实对手、赛程来源及原行上下文，防止下一对手变化后误用旧预览。设置为战术配置，比赛提交和实际效果另行核对。", oppositionArgs, ["rowPath", "kind", "optionPath", "expectedChoiceToken", "operationId"], opposition.set],
    ["get_set_piece_takers", "读取本队/当前执教比赛实际定位球主罚：现有主罚名单、候选、左右脚可添加权限、点球候选与点球名单；带action预览添加/移除/点球快选或主罚排序。", takerArgs, [], takers.get],
    ["change_set_piece_takers", "用原生完整候选/名单行执行定位球主罚添加（左右脚/双脚）、逐项移除、点球候选添加/移除、点球快选或主罚排序（单个 playerPaths 源行与零基 destination）；派发后需独立读回名单。", takerArgs, ["action", "expectedChoiceToken", "operationId"], takers.execute],
    ["get_set_piece_routine_state", "按实时属性名读取定位球套路/编辑状态（如 SetPieceDeliveryType、SetPieceCategoryInstructionList、SetPieceInstruction、SetPieceInstructionOptionsList）；属性名由调用方给出，不写死存档内容。", setPieceEditArgs, ["properties"], setPieceEdit.get],
    ["set_set_piece_routine_option", "在定位球编辑会话内把某个属性通道切换到游戏给出的选项（不伪造 payload）；先预览 token 再提交，之后独立读回。", setPieceEditArgs, ["action", "expectedChoiceToken", "operationId"], setPieceEdit.set],
    ["set_set_piece_edit_session", "开始/结束/取消定位球编辑会话（原生 EditSessionBegin/End/Cancel 事件）；派发不证明已生效，需读回会话与套路状态。", setPieceEditArgs, ["action", "expectedChoiceToken", "operationId"], setPieceEdit.set],
    ["edit_set_piece_routine_details", "修改定位球套路站位指令、跑位次级指令、发球/频率及职责人员分配（TAC-O26b/c/d）。", { setPieceType: { type: "integer", minimum: 0, default: 0 }, action: { type: "string", enum: ["instruction", "secondary_instruction", "delivery", "frequency", "assign_takers", "assign_category", "refresh_responsibilities", "undo"] }, value: {}, operationId: text }, ["action"], setPieceEdit.editRoutine],
    ["get_conversation_replies", "从实际人物/球队会谈读取四类原SpeakTo回应及确认内容；额外按钮/下拉视图只读，不能冒用索引。当前不创建新会谈或伪造直接34标量回复。", conversationArgs, ["source"], conversationReplies.get],
    ["reply_to_conversation", "按现有实际会谈的原bucket/actionIndex/token执行正常共享业务叶回应。保留禁用/确认与共享会话占用检查，派发不等于会谈结果或承诺达成。", conversationArgs, ["source", "actionIndex", "expectedChoiceToken", "operationId"], conversationReplies.reply],
    ["get_mentoring_groups", "读取实际球队指导小组、成员、草稿和可选球员；选择groupPath或mode=new可读详情，指定action预览。创建使用create，新组来自实际NewlyCreatedMentoringGroup；确认与选人分开。", mentoringArgs, [], mentoring.get],
    ["manage_mentoring_group", "经游戏正常协议创建/初始化/删除指导小组、选择实际成员、自动选择/清空/撤销、确认或改名。保持原人数上限及本版确认Count=3规则；共享草稿占用时停止，不修改UI选中行。派发不证明成员或指导效果已生效。", mentoringArgs, ["action", "expectedChoiceToken", "operationId"], mentoring.execute],
    ["get_person_management_actions", "读取球员/员工当前提供的31类正常管理菜单：转会/租借名单与召回、出场时间/纪律/准假/课程、球探报告/短名单/目标/规划器、合同撤回/续约委派/解约等。指定action读菜单，再带entry预览原确认内容。仅DoAction叶可执行。", managementArgs, [], personManagement.get],
    ["execute_person_management_action", "按本人的实际合法菜单和原entry/token执行正常管理业务，保留禁用与确认规则。包含解约/释放等有后果动作，按用户具体意图及原确认内容决定；不改属性/归属或强制转会。派发不证明最终效果。", managementArgs, ["action", "entry", "expectedChoiceToken", "operationId"], personManagement.execute],
    ["get_transfer_activity", "实时读取当前俱乐部球员/员工转会活动或独立trades交易；交易直接选offerPath且无拖延，普通转会先取personPath，再取offerPath，可读报价状态/买卖双方/实际可回应操作。提供action取得预览token。", activityArgs, [], activity.get],
    ["get_player_incoming_transfer_offers", "从当前俱乐部的转会中心读取指定球员的实际买入或租借报价，返回原报价 ID、状态、类型与列表索引。", { source: text, path: text }, ["source"], activity.incomingForPlayer],
    ["get_transfer_offer_draft_start", "核对游戏给当前经理提供的提出报价权限，读取实际球员、买方和卖方并预览打开草稿。", { source: text, path: text }, ["source"], actions.transferDraftPreview],
    ["open_transfer_offer_draft", "按原报价权限和预览 token 让游戏创建或复用报价草稿，并读取买方身份、编辑权限和报价类型。可在草稿中另选转会或租借，提交报价另行执行。", { source: text, path: text, expectedChoiceToken: text, operationId: text }, ["source", "expectedChoiceToken", "operationId"], actions.openTransferDraft],
    ["respond_transfer_activity_offer", "对转会中心实际报价接受、拖延或执行游戏当前取消/拒绝/撤回动作。使用原生权限及具体报价引用，不修改UI选中行；同预览换请求号也防重。派发不是成交或签约。", activityArgs, ["offerPath", "action", "expectedChoiceToken", "operationId"], activity.execute],
    ["get_precontract_promises", "读取实际签约前承诺草稿、未来出场时间与合法选项，按action/componentPath/optionPath预览约定出场时间、承诺增删/关联值/锁定、未来出场与目标类型。", precontractArgs, ["source"], precontract.get],
    ["change_precontract_promise", "通过原PreContractPromisesEditSession组件和原生候选操作签约前承诺草稿。保留只读/愿意谈判/可移除和锁定限制；不等于承诺履行或正式签约。", precontractArgs, ["source", "action", "expectedChoiceToken", "operationId"], precontract.execute],
    ["get_training_week_copy", "预览复制训练周（事件 962751567，target=human.TrainingCalendar，data=所选周 date）；按 weekIndex 读取 CalendarWeekAsList 行的 Date。只读。", trainingWeekCopyArgs, ["weekIndex"], trainingWeekEdit.copyPreview],
    ["copy_training_week", "按原 token 发送 CopyTrainingWeek(962751567)；派发不证明已复制或应用。", trainingWeekCopyArgs, ["weekIndex", "expectedChoiceToken", "operationId"], trainingWeekEdit.copyExecute],
    ["get_training_week_paste", "预览向所选训练周粘贴游戏当前已复制的训练内容，核对原生粘贴权限。", trainingWeekCopyArgs, ["weekIndex"], trainingWeekEdit.pastePreview],
    ["paste_training_week", "通过游戏原生粘贴事件应用已复制训练周。需要原预览 token 和操作号，实际配置应独立读回。", trainingWeekCopyArgs, ["weekIndex", "expectedChoiceToken", "operationId"], trainingWeekEdit.pasteExecute],
    ["get_training_week_edit", "预览提交或取消当前训练周编辑（TrainingScheduleEditor，事件 4108082463/4108082471，target=human.TrainingCalendar，data=null）；只读。", trainingWeekEditArgs, [], trainingWeekEdit.get],
    ["change_training_week_edit", "按原 token 提交或取消训练周编辑；派发不证明训练计划已应用。", trainingWeekEditArgs, ["action", "expectedChoiceToken", "operationId"], trainingWeekEdit.execute],
    ["get_assistant_individual_training", "预览让助手按当前球队训练状态分配个人训练（事件 911762251，target=TeamTraining）；只读预览。", { expectedChoiceToken: text, operationId: text }, [], playerSide.assistantTrainingPreview],
    ["assign_individual_training_by_assistant", "向 TeamTraining 发送 AssistantAssignIndividualTraining(911762251)；派发不证明个人训练已分配。", { expectedChoiceToken: text, operationId: text }, ["operationId"], playerSide.assistantTrainingExecute],
    ["get_agent_offer_discard_preview", "预览从经纪人报价列表丢弃一名球员（事件 134，target=human，data=Person）或全部（1316449644）；只读。", playerSideArgs, [], playerSide.discardOfferPreview],
    ["discard_agent_offer", "按原 token 执行丢弃单个/全部经纪人报价；派发不证明列表已移除。", playerSideArgs, ["expectedChoiceToken", "operationId"], playerSide.discardOfferExecute],
    ["get_tactic_change_state", "读取当前战术的 CanRevert/CanConfirmChanges，并可预览 next-match-only/cancel/confirm；只读。", tacticChangeArgs, [], tacticChange.state],
    ["change_tactic_state", "执行战术变化生命周期：1933068080 next-match-only、846559841 cancel（CanRevert 门禁）、1937405795 confirm（CanConfirmChanges 门禁）；派发不证明变化已生效。", tacticChangeArgs, ["action", "expectedChoiceToken", "operationId"], tacticChange.execute],
    ["rename_tactic", "重命名当前战术槽名称并独立读回校验（TAC-O06）。", { name: text }, ["name"], tacticChange.rename],
    ["get_opposition_advice_apply", "预览应用针对性指令建议（事件 1853321843，target=Tactic，data=AllOppositionInstructionSuggestions）；只读。", oppositionAdviceArgs, [], oppositionAdvice.preview],
    ["apply_opposition_instruction_advice", "按原 token 发送 OppositionInstructionsApplyAdvice(1853321843)；派发不证明指令已应用。", oppositionAdviceArgs, ["expectedChoiceToken", "operationId"], oppositionAdvice.apply],
    ["get_staff_meeting_apply_all", "预览 staff meeting 对所有比赛应用建议（事件 70696，target=StaffMeeting，data=null）；只读。", staffMeetingArgs, [], staffMeeting.preview],
    ["apply_staff_meeting_advice_all", "按原 token 发送 ApplyAllAdviceAllMatches(70696)；派发不证明建议已应用。", staffMeetingArgs, ["expectedChoiceToken", "operationId"], staffMeeting.applyAll],
    ["get_match_preparation_session_confirm", "读取赛前准备可用性和会话列表；提供 sessionIndex 时预览该行的原生确认操作。只读。", matchPreparationArgs, [], matchPreparation.preview],
    ["confirm_match_preparation_session", "按原 token 发送 ConfirmTrainingSessionFromMenu(846022770)；派发不证明会话已应用。", matchPreparationArgs, ["sessionIndex", "expectedChoiceToken", "operationId"], matchPreparation.confirm],
    ["get_set_piece_tactic_update", "预览请求助手更新定位球战术（事件 1296390501，target=tactic.SetPiece，data=true）；只读。", setPieceRoutineArgs, [], setPieceRoutine.preview],
    ["request_set_piece_tactic_update", "按原 token 发送 SetPieceRequestTacticUpdate(1296390501)；派发不证明 routine 已更新。", setPieceRoutineArgs, ["expectedChoiceToken", "operationId"], setPieceRoutine.execute],
    ["get_full_advice_request", "预览请求完整 staff 建议集合（事件 1397301300，target=human，data=null）；只读。", staffAdviceArgs, [], staffAdvice.preview],
    ["request_full_advice_collection", "发送 RequestFullAdviceCollection(1397301300)；派发不证明建议已生成或显示。", staffAdviceArgs, ["expectedChoiceToken", "operationId"], staffAdvice.request],
    ["get_tactic_analysis", "读取当前战术的原生评估（战术理解/球员能力/球员认同/下场比赛信息/整体效果/状态旗标/球员列表）与复杂度（默认 compact=true 精简输出防爆上下文，需全量树传 compact: false）；只读。", { compact: { type: "boolean", default: true } }, [], tacticAnalysis.get],
    ["get_opposition_report", "读取球队级对手报告原生观察数据与元数据（OppositionReportVisuals：时间范围、表现摘要、观察数据、对手/赛事引用）；报告正文若仅在战术面板绑定中提供，则不打开面板、不模拟输入。", {}, [], tacticAnalysis.opposition],
    ["get_tactic_suggestion", "预览让 staff 刷新战术建议（SuggestedTeam 1349935671 / SuggestedChanges 1114723152，target=Tactic，data=当前建议列表）；kind=team|changes。只读。", tacticSuggestionArgs, ["kind"], tacticSuggestion.preview],
    ["request_tactic_suggestion", "按原 token 发送建议刷新事件；派发不证明建议已重算或显示。", tacticSuggestionArgs, ["kind", "expectedChoiceToken", "operationId"], tacticSuggestion.execute],
    ["get_team_selection_delete", "预览删除已保存的球队选择（事件 1312180533，target=Tactic，data=Tactic.TeamSelections 叶子）；optionPath 必填。只读。", teamSelectionArgs, ["optionPath"], teamSelection.deletePreview],
    ["delete_team_selection", "按原 token 发送 DeleteTeamSelection(1312180533)；派发不证明列表已移除。", teamSelectionArgs, ["optionPath", "expectedChoiceToken", "operationId"], teamSelection.deleteExecute],
    ["list_team_selection_presets", "只读读取已保存的球队阵容选择预设列表（TeamSelections，SQU-O02）。", {}, [], teamSelection.listPresets],
    ["manage_team_selection_preset", "创建、覆盖保存、加载或重命名已保存的球队阵容选择预设（create/save/load/rename，SQU-O02a/b/c）。", { action: { type: "string", enum: ["create", "save", "load", "rename"], default: "create" }, name: text, optionPath: text, operationId: text }, [], teamSelection.managePreset],
    ["get_set_piece_creator", "读取定位球创建向导的阶段、原始候选及教练偏好；action=start/next/finish预览正常开始、答题或最后生成阶段的结束信号。完成状态与阵容校验分别核对。", creatorArgs, [], setPieceCreator.preview],
    ["execute_set_piece_creator_action", "按原token开始、提交当前题目原始答案，或仅在最后答题后的原生生成阶段finish；不在答题阶段强行完成。", creatorArgs, ["action", "expectedChoiceToken", "operationId"], setPieceCreator.execute],
    ["get_match_lineup_submission", "读取赛前正式阵容提交的游戏校验、具体问题与原阵容token。要求正常Tactics流程及合法阵容；不使用确认当前选择代替正式提交。", {}, [], lineupSubmission.get],
    ["submit_match_lineup", "按游戏正常ConfirmTeamSelection业务发送原始双布尔record，InstantResult和Cancelled均false；检查真实阵容有效性及玩家介入，派发不代表已开赛。", { expectedChoiceToken: text, operationId: text, mutationCursor }, ["expectedChoiceToken", "operationId", "mutationCursor"], lineupSubmission.submit],
    ["get_team_selection_confirm", "预览确认当前显示的球队选择（FullScreenTeamSelection，事件 1714714946，target=Tactic，data=true）；只读预览。", teamSelectionArgs, [], teamSelection.preview],
    ["confirm_team_selection", "发送 ConfirmShownTeamSelection(1714714946)确认当前球队选择；保留当前战术 token，派发不证明阵容已提交比赛。", teamSelectionArgs, ["operationId"], teamSelection.confirm],
    ["get_club_budget_adjustment", "读取当前俱乐部 Club.BudgetAdjustment 对话框状态（CanEditBudgets 与董事会/当前支出/FFP/球探/经纪费字符串）；带 action 可预览确认。", budgetAdjustmentArgs, [], budgetAdjustment.get],
    ["confirm_club_budget_adjustment", "按实际预算调整对话框发送 BudgetAdjustmentConfirm(146)；保留 CanEditBudgets 门禁，派发不证明预算已被游戏应用。", budgetAdjustmentArgs, ["expectedChoiceToken", "operationId"], budgetAdjustment.execute],
    ["get_code_of_conduct_fine", "读取当前俱乐部行为准则的罚款行（FineString/CanEdit/CanIncrementValue/CanDecrementValue）；提供 finePath 与 action 可预览 increment/decrement/change。", codeOfConductArgs, [], codeOfConduct.get],
    ["change_code_of_conduct_fine", "按 CodeOfConductFineReference 行执行 80 increment / 79 decrement / 1850488427 下拉变更；保留 Can* 门禁，派发不证明罚款生效。", codeOfConductArgs, ["finePath", "action", "expectedChoiceToken", "operationId"], codeOfConduct.execute],
    ["get_captaincy_standin", "读取指定球员的可编辑替补队长下拉候选、当前 index 与 CanEditCaptainsStandinIndex；带 optionPath 可预览选择。", captaincyArgs, ["source"], captaincy.get],
    ["set_captaincy_standin", "按 IPlayerReference 的 CaptainsStandinDropdownOptions 候选发送 SetCaptaincyStandinIndex(1315005289)；保留 CanEdit 门禁，派发不证明已生效。", captaincyArgs, ["source", "optionPath", "expectedChoiceToken", "operationId"], captaincy.set],
    ["get_club_vision_draft", "读取俱乐部愿景会议草稿（CanEdit/CanUndo/CanRevert/CanConfirmTerms/CanSuggestTerms 与可添加目标）；带 action 预览 add-objective/remove-objective/undo/revert/suggest/confirm。仅草稿。", clubVisionArgs, [], clubVision.get],
    ["change_club_vision_draft", "按 ClubVisionMeetingEditSession 原事件添加/移除愿景目标或 undo/revert/suggest/confirm；保留各 Can* 门禁，派发不等于董事会接受愿景。", clubVisionArgs, ["action", "expectedChoiceToken", "operationId"], clubVision.execute],
    ["get_club_affiliate_draft", "读取当前俱乐部 AffiliateEditSession 草稿（CanCommitAffiliateProposal/Count/候选关联俱乐部/已选俱乐部）；带 action 可预览 select-index/propose/cancel-proposal。仅草稿，不证明关联已建立。", clubAffiliateArgs, [], clubAffiliate.get],
    ["change_club_affiliate_draft", "按实际关联俱乐部会话执行 select-index/propose/cancel-proposal 原事件；propose 以 CanCommitAffiliateProposal 为门禁，派发不等于关联已创建。", clubAffiliateArgs, ["action", "expectedChoiceToken", "operationId"], clubAffiliate.execute],
    ["cancel_club_affiliate_link", "请求或确认结束现有附属俱乐部合作关系（CLB-O09）。", { confirm: { type: "boolean", default: false }, affiliateIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], clubAffiliate.cancelLink],
    ["get_team_training_intensity", "按 conditionRange(0..4) 读取球队体能区间训练强度的原始设置记录与合法候选；带 optionPath 预览，单独带 operationId 可独立核对该区间草稿配置。", teamIntensityArgs, [], teamIntensity.get],
    ["set_team_training_intensity", "按原生 TrainingIntensities 候选发送 SetTrainingIntensity(1681470056)；保留当前值/候选 token 校验，派发不证明强度已生效。", teamIntensityArgs, ["optionPath", "expectedChoiceToken", "operationId"], teamIntensity.set],
    ["get_custom_training_schedule", "读取自定义训练日程草稿；includeOptions 可读取原生候选及其行结构。提供 action 可预览 begin/save/clear/create/confirm/delete。", { ...trainingScheduleArgs, includeOptions: { type: "boolean" } }, [], trainingSchedule.get],
    ["manage_custom_training_schedule", "通过原定制训练计划引用执行 begin/save/clear/create；confirm 用 TrainingSchedules 候选；delete 用日程行 EventData 发游戏真实删除事件 1632055349（请求事件 2001683788 单独不会删除）。保存/清空有 Can* 门禁，派发不等于已保存、删除或生效。", trainingScheduleArgs, ["action", "expectedChoiceToken", "operationId"], trainingSchedule.execute],
    ["rename_custom_training_schedule", "重命名已有自定义训练日程并保存读回校验（TRN-O05b）。", { newName: text, optionPath: text, operationId: text }, ["newName"], trainingSchedule.rename],
    ["get_trade_offer_draft", "读取当前俱乐部 TradeOffers 中实际 trade 报价的草稿：编辑类型、买卖方、可协商状态、双方已提供/可用资产列表；提供 offerIndex 后按 action 预览资产增删或可协商选项。仅草稿，不提交或成交。", tradeArgs, [], trades.get],
    ["change_trade_offer_draft", "按原 TradeOfferEditSession 属性与资产候选增删 trade 资产或设置可协商选项；保留 CanRemoveAsset/启用状态与 token 检查，派发不等于成交或签约。", tradeArgs, ["offerIndex", "action", "expectedChoiceToken", "operationId"], trades.execute],
    ["get_match_shout_recipients", "读取当前临场喊话球员候选/已选对象；提供playerIndices预览选择原完整球员行。带operationId可只读观察原选择，不发送喊话。", shoutPlayers, [], shouts.getRecipients],
    ["select_match_shout_recipients", "按游戏原球员候选设置临场喊话个人对象，保留不可选规则及原生选择事件；随后重新预览喊话再执行。此步骤不喊话、不证明情绪改变。", shoutPlayers, ["playerIndices", "expectedChoiceToken", "operationId"], shouts.selectRecipients],
    ["get_match_shouts", "读取当前比赛临场喊话、冷却/职责可用性、当前组别与收件人；提供kind和optionIndex可预览。组别采用游戏原值4,1,2,3，喊话采用候选index。", shoutArgs, [], shouts.get],
    ["execute_match_shout", "按游戏当前合法候选向实际收件人喊话，或改变喊话组别。保持原MatchTactic及完整原始载荷、冷却规则；派发不能证明情绪或比赛表现改变。", shoutArgs, ["optionIndex", "expectedChoiceToken", "operationId"], shouts.execute],
    ["get_training_unit_summaries", "实时读取进攻、防守、中场、门将训练单元的参与度/属性影响摘要。尚未恢复可手动调组流程，此入口只读。", {}, [], trainingUnits.get],
    ["get_training_panel_state", "按实时属性名读取训练/战术面板数据（root=training|team|tactic）；例如 CoachAssignments、MatchPreparationSessions、TrainingIntensityOrRest、TacticalIntensity。属性名由调用方提供，不写死存档内容。", { root: { type: "string", enum: ["training", "team", "tactic"], default: "training" }, properties: { type: "array", items: text } }, ["properties"], trainingState.get],
    ["get_player_training_action_options", "读取游戏当前提供的球员训练报告、训练休息计划或取消休息原生菜单。具体休息时长从实际菜单选择，未知确认分支暂拒绝。", trainingMenuArgs, ["action"], playerTrainingMenu.get],
    ["execute_player_training_action", "按原始训练业务菜单请求训练报告、安排/取消训练休息。需原entry/token，不改变球员属性或直接写恢复时间；仅记录业务派发。", trainingMenuArgs, ["action", "entry", "expectedChoiceToken", "operationId"], playerTrainingMenu.execute],
    ["get_player_availability_options", "读取本俱乐部球员游戏当前提供的队伍调动/预备队可出场性菜单。具体队伍与分钟限制取原生选项，不使用编辑器强制转会。", availabilityArgs, ["source"], availability.get],
    ["change_player_availability", "按游戏合法菜单将球员调入一线/预备/青年队或设置预备队出场可用性。需原entry/token，明确游戏确认；仅派发，不宣称已经改变队伍或出场资格。", availabilityArgs, ["source", "action", "entry", "expectedChoiceToken", "operationId"], availability.execute],
    ["get_coach_category_assignments", "读取当前原教练列表及9类分工；coachPath/category后预览指定教练的分配/取消意图及CanEdit。", coachCategoryArgs, [], trainingManagement.getCategory],
    ["set_coach_category_assignment", "使用原始EventData为指定教练分配或取消进攻/防守/控球、门将、体能、定位球训练类别，保留CanEdit与原token。", coachCategoryArgs, ["coachPath", "category", "assigned", "expectedChoiceToken", "operationId"], trainingManagement.setCategory],
    ["get_coach_assignments", "读取当前球队原生教练分工，预览助手自动分配或清空分工的正常业务。原UI没有额外CanEdit字段，授权与实际规则由游戏执行。", coachArgs, [], trainingManagement.get],
    ["change_coach_assignments", "通过原生事件让助手自动分配教练或清空分工，需完整分工快照的原token。派发不等于分工生效，暂不支持单个教练勾选。", coachArgs, ["operation", "expectedChoiceToken", "operationId"], trainingManagement.change],
    ["get_friendly_dates", "读取游戏实际AvailableDates，经原SDK日期转换取得有限可选列表；dateIndex后预览原生日期，operationId可独立观察草稿日期。", friendlyDateArgs, [], friendlySelection.dates],
    ["set_friendly_date", "从游戏当前允许日期选index，通过原DateSelector绑定对应的正常Date命令设置友谊赛日期；不拼packed数值，不自动确认安排。", friendlyDateArgs, ["dateIndex", "expectedChoiceToken", "operationId"], friendlySelection.setDate],
    ["get_medical_report_options", "读取游戏当前为真实球员提供的队医报告/伤病风险更新菜单，entry后预览原生业务叶。不修改伤病、体能等数值，治疗决定需实际合法回应流程。", medicalArgs, ["source", "action"], medical.get],
    ["request_medical_report", "按实际原生菜单请求队医报告或伤病风险更新，需原entry/token；只记录请求派发，不等于已收到报告或完成治疗。", medicalArgs, ["source", "action", "entry", "expectedChoiceToken", "operationId"], medical.execute],
    ["get_press_conference_state", "读取原生发布会状态；邀请选项消失后提供先前返回的 conferenceId 和 conferenceIdentity 查询结束状态。", { index: { type: "integer", minimum: 0 }, expectedNewsIdentity: text, conferenceId: text, expectedConferenceIdentity: text }, ["index", "expectedNewsIdentity"], news.pressConference],
    ["get_manager_promises", "分页读取当前经理的原生活跃或已完成承诺列表，以及游戏提供的期限、状态和履约进度。", { completed: { type: "boolean" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 20 } }, [], news.promises],
    ["get_squad_happiness_issues", "分页读取当前球队不满事项、涉及球员数和原生关联承诺数量。", { offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 20 } }, [], news.happinessIssues],
    ["open_press_conference_for_player", "从完整收件箱的原始发布会邀请请求打开游戏原生发布会面板，交给玩家。回执只确认派发。", { index: { type: "integer", minimum: 0 }, expectedNewsIdentity: text, operationId: text }, ["index", "expectedNewsIdentity", "operationId"], news.openPressConference],
    ["answer_press_conference_question", "选择当前发布会的原生回答；须提供题号、选项下标和预览 token。", { index: { type: "integer", minimum: 0 }, expectedNewsIdentity: text, expectedQuestion: text, actionIndex: { type: "integer", minimum: 0 }, expectedChoiceToken: text, operationId: text, acceptConfirmation: { type: "boolean" } }, ["index", "expectedNewsIdentity", "expectedQuestion", "actionIndex", "expectedChoiceToken", "operationId"], news.pressConference],
    ["start_press_conference", "按发布会状态工具返回的原生预览 token 启动发布会或派游戏内助教出席。handoff 默认 start，delegate 仅当游戏实际提供委派动作时可用。不读取或回答发布会问题。", { index: { type: "integer", minimum: 0 }, expectedNewsIdentity: text, expectedChoiceToken: text, operationId: text, handoff: { type: "string", enum: ["start", "delegate"] }, acceptConfirmation: { type: "boolean" } }, ["index", "expectedNewsIdentity", "expectedChoiceToken", "operationId"], news.pressConference],
    ["get_mark_all_messages_read_preview", "预览当前经理收件箱全部标为已读，返回实际未读数和token；带原operationId独立观察未读数，不证明每条消息的独占因果。", { operationId: text }, [], inboxManagement.get],
    ["mark_all_messages_read", "通过游戏正常MarkAllHumanMessagesAsRead业务将当前经理消息全部标为已读（未传 token 时自动内部预览并执行，不打开收件箱页面）。", { expectedChoiceToken: text, operationId: text }, [], inboxManagement.execute],
    ["get_registration_player_selection", "读取实际注册候选名单；personPath和selected后预览该球员勾选/取消的合法性，保留当前Person上下文。带operationId可独立观察原注册草稿。", registrationPlayer, [], registrationSelection.get],
    ["set_registration_player", "正常勾选或取消原生注册候选，检查CanChangeSelection与原token；只改变注册草稿，不自动确认提交。", registrationPlayer, ["personPath", "selected", "expectedChoiceToken", "operationId"], registrationSelection.set],
    ["set_registration_players", "按每人的原始预览逐名设置注册草稿，遇权限变化、失败或未知结果停止。各子请求号固定为根号:index；非原子、不回滚已完成项、不自动最终提交。", { changes: { type: "array", items: { type: "object", properties: { personPath: text, selected: { type: "boolean" }, expectedChoiceToken: text }, required: ["personPath", "selected", "expectedChoiceToken"], additionalProperties: false }, minItems: 1, maxItems: 100 }, contexts: { type: "object" }, squadSelectionRule: { type: "integer", minimum: 0 }, operationId: text }, ["changes", "operationId"], registrationSelection.setMany],
    ["get_friendly_selection_options", "读取友谊赛实际对手或规则候选；optionPath后预览完整原生选择记录。", friendlySelectionArgs, ["kind"], friendlySelection.get],
    ["change_friendly_selection", "按游戏正常选择事件设置友谊赛对手或比赛规则，复制原候选，不能拼球队/规则ID；最后确认仍用change_friendly_arrangement confirm。", friendlySelectionArgs, ["kind", "optionPath", "expectedChoiceToken", "operationId"], friendlySelection.execute],
    ["get_friendly_arrangement", "读取当前球队真实友谊赛安排的日期/对手/规则/有效性，预览主客场切换、确认或取消该安排草稿；尚未接入对手/规则/日期选择。", friendlyArgs, [], friendly.get],
    ["change_friendly_arrangement", "正常切换主客场、确认游戏判定合法的友谊赛安排，或取消安排草稿。检查实际有效性和CanPlayAway；确认同意图不能换号重发。不是取消已安排赛程的接口，派发不证明生成了赛程。", friendlyArgs, ["operation", "expectedChoiceToken", "operationId"], friendly.execute],
    ["get_player_squad_number_options", "读取实际号码会话Players名单；选择playerPath后取得该球员合法号码候选，optionPath后预览。带原operationId独立观察草稿，不等于提交后的球衣号码。", playerNumberArgs, [], squad.getPlayerNumber],
    ["set_player_squad_number", "通过游戏正常号码选择绑定写入原始候选记录，检查CanChangeSquadNumber与实际Person上下文；只改编辑草稿，最终提交用change_squad_numbers confirm。", playerNumberArgs, ["playerPath", "optionPath", "expectedChoiceToken", "operationId"], squad.setPlayerNumber],
    ["get_squad_registration", "读取当前球队正常注册会话、候选与已选名单；可预览自动选择、清空、撤销或确认。附加上下文来自实际游戏metadata，默认原UI规则165。", registrationArgs, [], squad.getRegistration],
    ["change_squad_registration", "正常让助理自动选择、清空、撤销或确认注册名单，保留游戏注册规则及CanConfirmChanges等门槛。派发不等于注册被引擎接受，尚不支持逐人勾选。", registrationArgs, ["operation", "expectedChoiceToken", "operationId"], squad.changeRegistration],
    ["get_board_request_options", "从当前经理俱乐部的原生BoardRequestSpeakTo菜单读取真实董事会请求；optionPath后预览原动作、确认内容和token，不打开董事会页面。", boardArgs, [], board.get],
    ["get_club_panel_state", "通用低层属性面板读取器（root=club|team|tactic）；常规查询建议优先使用 get_club_history_and_overview、get_club_confidence_and_culture、get_squad_dynamics_and_hierarchy 等聚合预设工具，无需手动猜测属性名。", { root: { type: "string", enum: ["club", "team", "tactic"], default: "club" }, properties: { type: "array", items: text } }, ["properties"], clubState.get],
    ["get_panel_state", "通用低层属性面板读取器（root=human|club|team|training|tactic|player，支持传入 squadIndex 读取指定一线队球员属性）；常规查询建议优先使用各领域专用聚合工具。", { root: { type: "string", enum: ["human", "club", "team", "training", "tactic", "player"], default: "human" }, squadIndex: { type: "integer", minimum: 0, default: 0 }, handle: text, properties: { type: "array", items: text }, contexts: { type: "object", additionalProperties: true } }, ["properties"], panelState.get],
    ["live_describe", "通用只读通道：自省任意实时节点（如 club/team/human/training/tactic/match 或 { source: 'team', path: 'Players' }）上所有可用属性名、所需上下文与大概类型。查冷门字段时先调它，再调 live_query，无需猜属性名。", {
      node: { description: "目标节点：字符串（如 'club'、'team.Players'）或对象 { source, path }。", oneOf: [text, { type: "object", properties: { source: text, path: text }, required: ["source"] }] },
      filter: { type: "string", description: "可选：按关键字过滤属性名或类型。" },
      limit: { type: "integer", minimum: 1, maximum: 500, default: 120, description: "最多返回多少个属性条目。" },
      contexts: { type: "object", additionalProperties: true, description: "可选：手动补齐上下文。" }
    }, ["node"], liveQuery.describe],
    ["live_query", "通用只读通道：按结构化参数查询任意实时节点的任意属性（支持列表过滤/排序/分页、单节点字段读取、自动补上下文、一层引用解析与 hex 键解码）。业务工具没覆盖的冷门字段优先用它，严格只读。", {
      node: { description: "目标节点：字符串（如 'club'、'team.Players'）或对象 { source: 'team', path: 'Players/19' }。", oneOf: [text, { type: "object", properties: { source: text, path: text }, required: ["source"] }] },
      select: { type: "array", items: text, description: "要读取的属性名数组（例如 ['LoanClub', 'LoanClubWageContribution']）。" },
      where: {
        type: "array",
        description: "可选：结构化过滤条件数组。",
        items: {
          type: "object",
          properties: {
            field: text,
            op: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"], default: "eq" },
            value: {}
          },
          required: ["field", "value"]
        }
      },
      orderBy: {
        type: "object",
        description: "可选：按字段排序。",
        properties: {
          field: text,
          dir: { type: "string", enum: ["asc", "desc"], default: "asc" }
        },
        required: ["field"]
      },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 30 },
      offset: { type: "integer", minimum: 0, default: 0 },
      resolveRefs: { type: "boolean", default: true, description: "是否自动把引用类型解析成 Name（最多一层）。" },
      raw: { type: "boolean", default: false, description: "是否返回未压缩的原始动态树（默认 false）。" },
      contexts: { type: "object", additionalProperties: true, description: "可选：手动补充上下文（如 Person/Team/Club）。" }
    }, ["node", "select"], liveQuery.query],
    ["submit_board_request", "提交游戏当前提供的董事会请求原始业务动作，不能拼事件/请求数值。需要原token，确认时显式acceptConfirmation；仅派发，不宣称董事会已同意或建设等结果完成。", boardArgs, ["optionPath", "expectedChoiceToken", "operationId"], board.execute],
    ["get_transfer_clause_dates", "读取实际报价条款的开始/结束日期和游戏允许的最早/最晚边界；提供dateSource原生日期值后预览，不拼packed日期。", transferDateArgs, ["source", "kind", "collection", "clausePath"], proposal.dateGet],
    ["change_transfer_clause_date", "按游戏正常日期业务事件修改报价条款的开始或结束日期，使用真实GameDate及原token，检查合法边界。仅草稿，不提交或强制转会。", transferDateArgs, ["source", "kind", "collection", "clausePath", "dateSource", "expectedChoiceToken", "operationId"], proposal.dateExecute],
    ["get_recruitment_focus_lifecycle", "按已有重点的真实focusPath预览重新启动、结束或删除；返回游戏确认语义和token。", focusLifeArgs, ["focusPath", "action"], focusLifecycle.get],
    ["change_recruitment_focus_lifecycle", "通过正常ScoutingInfo业务结束/重启/删除已有重点，保留原UniqueId类型；完成/删除需显式接受确认，不代表球探任务已经被引擎处理。", focusLifeArgs, ["focusPath", "action", "expectedChoiceToken", "operationId"], focusLifecycle.execute],
    ["get_captain_options", "读取当前球队队长/副队长真实动作菜单，entry后预览原始选人载荷。", captainArgs, ["kind"], squad.getCaptains],
    ["set_captain", "按当前球队真实菜单选项任命队长或副队长，需要原entry/token。", captainArgs, ["kind", "entry", "expectedChoiceToken", "operationId"], squad.setCaptain],
    ["get_squad_number_options", "读取当前球队号码编辑会话和自动分配/清空/撤销/确认操作预览。", numbersArgs, [], squad.getNumbers],
    ["change_squad_numbers", "正常自动分配、清空、撤销或确认号码草稿；确认需实际CanConfirmChanges，回执不代替最终分配观察，单个号码选择仍在补充。", numbersArgs, ["operation", "expectedChoiceToken", "operationId"], squad.changeNumbers],
    ["get_transfer_proposal_options", "读取实际报价的交换球员名单及推荐范围限制；选择原playerPath或开关后预览。", proposalArgs, ["source", "kind"], proposal.get],
    ["change_transfer_proposal", "正常选择/取消交换球员，或调整是否排除竞争对手/海外/国内/非顶级联赛俱乐部的推荐范围草稿。不是强制球员转会。", proposalArgs, ["source", "kind", "selected", "expectedChoiceToken", "operationId"], proposal.execute],
    ["get_communication_actions", "从真实对象SpeakTo链读取当前游戏提供的沟通回应；只开放共享业务载荷的简单动作，导航/卡片/额外新闻前置标记不可执行。", communicationArgs, ["source"], communication.get],
    ["execute_communication_action", "按游戏当前提供的沟通选项发送原始业务回应，不能自选事件或拼payload；原token和固定请求号必填。需游戏确认时显式acceptConfirmation，回执只证明派发。", communicationArgs, ["source", "actionIndex", "expectedChoiceToken", "operationId"], communication.execute],
    ["get_contract_structure_options", "读取真实合同谈判的奖金/条款新增候选、原始组件选择和预览token；也可预览删除、锁定、金额逐档调整、重置或采用现有合同。", contractComponent, ["action"], contractStructure.get],
    ["change_contract_structure", "通过合同正常业务增删奖金/条款、合法数字/锁定候选、费用增减、重置或采用现有合同。需原预览token；只编辑谈判草稿，不等于正式提交或签约。", contractComponent, ["action", "expectedChoiceToken", "operationId"], contractStructure.execute],
    ["get_staff_responsibilities", "读取实际球队设置中的职责页签、组与单项职责。逐层指定原生path；给出action时预览接管/委派操作及token。", responsibility, [], administration.get],
    ["change_staff_responsibility", "通过游戏正常职责事件接管或委派单项、接管职责组或交给推荐员工。要求原预览token，检查CanHumanChange/CanHumanTakeControl；改变的是工作分工。", responsibility, ["tabPath", "groupPath", "action", "expectedChoiceToken", "operationId"], administration.change],
    ["get_training_batch_options", "批量读取1..50名真实球员的训练强度/休息、专项与角色候选；每项提供optionIndex时取得该人的原预览token。", { players: { type: "array", items: batchPlayer, minItems: 1, maxItems: 50 } }, ["players"], trainingBatch.get],
    ["set_training_batch", "逐名执行正常训练选择，可批量安排游戏提供的休息/强度/专项/角色选项。每项需原token/current和独立固定operationId；已有历史、失败或结果未确认立即停止，不执行后续人选。非原子操作，已完成项不会回滚。", { players: { type: "array", items: batchPlayer, minItems: 1, maxItems: 50 } }, ["players"], trainingBatch.set],
    ["get_match_stage_options", "读取当前执教比赛阶段及合法继续预览；覆盖球队谈话、开赛/热身、阵容/球队新闻、半场/加时休息、点球人选及全场结束等正常阶段。检查玩家继续冷却、战术草稿和多人等待状态。带operationId只读恢复原回执及阶段观察。", { operationId: text }, [], stage.state],
    ["continue_match_stage", "通过当前真实阶段业务方法继续：保留原生战术提交前置与阶段自身规则，正常完成谈话/进入下一阶段；正常阶段视图会随比赛进程更新。要求原token、比赛身份、游标和固定请求号；不直接触发FSM、不重发未知结果。", { expectedMatchIdentity: text, expectedChoiceToken: text, mutationCursor, operationId: text }, ["expectedMatchIdentity", "expectedChoiceToken", "mutationCursor", "operationId"], stage.advance],
    ["get_continue_game_state", "读取继续游戏预览：当前经理、原生等待状态、日期、实际模块/比赛阶段与请求 token。带 operationId 可恢复日志并观察等待；不代表日期或阶段已推进，不发送继续事件。", { operationId: text }, [], continuation.state],
    ["request_continue_game", "用原预览身份/token/活动游标和固定请求号，发送一次正常原生继续请求。已在等待、状态变化、玩家介入或同意图另号重复时拒绝；不重发未知结果。等待仅核对请求状态，比赛推进另需观察；当前版本面板副作用与实际接受仍待真机。", { expectedGameIdentity: text, expectedChoiceToken: text, mutationCursor, operationId: text }, ["expectedGameIdentity", "expectedChoiceToken", "mutationCursor", "operationId"], continuation.request],
    ["get_match_simulation_state", "通过游戏自己的 SI.Match.IPluginMatchInterface 只读查询当前执教比赛的实际模拟 period，核对原生句柄及比赛唯一身份；与页面FSM阶段分开。句柄/版本不匹配时返回未就绪，不创建比赛、不Tick/Seek或切换页面。不证明特定命令因果。", {}, [], () => call("/api/v1/match/simulation-state")],
    ["get_match_team_talk", "读取当前执教比赛的原生球队谈话状态、组别、原始球员行及 TalkingTo 候选；可读赛后当前比赛，禁止历史/回放/观战。带 operationId 可独立核验对象选择；具体发言/士气效果不由 IsCompleted 证明。", { operationId: text }, [], teamTalk.state],
    ["preview_match_team_talk_recipients", "预览普通谈话对象选择：kind:group 用 TalkingTo 的 optionIndex；kind:players 在 Individuals 模式用完整原始 playerPaths 行下标集合。候选内部组别不能直接当 setter 数值。", { kind: { type: "string", enum: ["group", "players"] }, optionIndex: { type: "integer", minimum: 0 }, playerPaths: { type: "array", items: text } }, ["kind"], teamTalk.previewSelection],
    ["select_match_team_talk_recipients", "按刚预览的 token 更新原生谈话对象并独立读回。group 验证仅覆盖组别，自动生成的成员集合另列观察；players 联合核对 Individuals 组别和完整球员引用集合，不发送具体讲话。", { kind: { type: "string", enum: ["group", "players"] }, optionIndex: { type: "integer", minimum: 0 }, playerPaths: { type: "array", items: text }, expectedChoiceToken: text, operationId: text }, ["kind", "expectedChoiceToken"], teamTalk.select],
    ["get_match_team_talk_actions", "读取当前原生 SpeakTo 讲话/交助手选项、禁用与确认内容。只展示已恢复154/155业务分支的静默可执行状态，不打开谈话面板。", { bucket: text }, [], teamTalk.actions],
    ["execute_match_team_talk_action", "执行本次原生讲话或交助手选项，保留原始 ResponseValue/NPC 和业务载荷。仅确认派发并独立观察谈话状态，不自动结束阶段/继续比赛，不把完成标志当具体讲话或士气效果。", { bucket: text, actionIndex: { type: "integer", minimum: 0 }, expectedChoiceToken: text, acceptConfirmation: { type: "boolean" }, operationId: text }, ["actionIndex", "expectedChoiceToken"], teamTalk.execute],
    ["get_recruitment_focuses", "读取当前经理原生招募重点列表，保留真实引用供 existing 模式的 focusPath 使用。", {}, [], recruitment.list],
    ["get_recruitment_focus_setting", "读取招募重点原生条件及合法选项。年龄/位置/持球和无球角色用 optionIndex 或 ChildList 树的 optionPath；名称/布尔/优先级用 input；能力门槛和角色熟练度要求用 input:increase/decrease，每次走游戏的一步增减。熟练度为 1～3 档筛选要求；角色 ID 保持原生 64 位值。", focusSetting, ["kind"], recruitment.get],
    ["stage_recruitment_focus_setting", "通过游戏正常绑定更新编辑实际招募重点草稿并独立读回，不提交重点。需要上次 expectedChoiceToken；new 的生命周期和实际底层会话隔离尚需真机验证。", { ...focusSetting, expectedChoiceToken: text, operationId: text }, ["kind", "expectedChoiceToken"], recruitment.set],
    ["get_recruitment_focus_draft", "读取实际重点已恢复的字段快照和提交 token；包含有效性/重名、年龄、优先级、区域和球探列表等，尚不是完整筛选条件序列化。", focusSource, [], recruitment.draft],
    ["get_recruitment_focus_areas", "读取实际重点地区。add 返回当前经理球队的原生候选树；remove 返回当前地区和列表下标。提供 optionPath 可预览原始载荷和 token，地区 ID 不从名称猜测。", { ...focusSource, action: { type: "string", enum: ["add", "remove"] }, optionPath: text }, ["action"], recruitment.areas],
    ["change_recruitment_focus_area", "按原生地区候选添加或按原始已选记录移除地区，独立核对相同对象的出现/消失；只编辑重点草稿，不提交或声称球探已开始工作。", { ...focusSource, action: { type: "string", enum: ["add", "remove"] }, optionPath: text, expectedChoiceToken: text, operationId: text }, ["action", "optionPath", "expectedChoiceToken"], recruitment.changeArea],
    ["get_recruitment_focus_staff", "读取重点球探或分析员模式、当前人员和真实 Team.TeamContainer 候选。explicit 加 personPaths 原列表下标可预览手动选择；any 可预览任意人员模式及清空显式名单的副作用。带 operationId 可独立核验模式与人员集合，不以姓名合成人员 ID。", { ...focusStaff, operationId: text }, ["kind"], recruitment.staff],
    ["stage_recruitment_focus_staff", "通过正常任意人员开关和原生人员引用列表更新重点草稿；explicit 必须提供完整 personPaths，可为 []。独立核对模式与完整人员集合；不提交重点或宣称球探任务运行。切到手动后再选择是两个普通业务操作，异常时可能部分执行，不自动重发。", { ...focusStaff, expectedChoiceToken: text, operationId: text }, ["kind", "selection", "expectedChoiceToken"], recruitment.stageStaff],
    ["complete_recruitment_focus_draft", "按游戏原生事件提交或取消重点草稿；提交前核对有效性、名称和旧 token。回执只证明派发，实际创建/修改和球探任务生效另查。", { ...focusSource, action: { type: "string", enum: ["submit", "cancel"] }, expectedDraftToken: text, operationId: text }, ["action", "expectedDraftToken"], recruitment.complete],
    ["get_team_training_sessions", "读取月日历；dayPath 后读取实际当天事件；eventPath 后读取训练时段和合法训练菜单。具体叶记录 optionPath 可预览。delegation 可显式选择游戏的仅本次或接管全部训练；后者改变后续职责分配。", { monthPath: text, dayPath: text, eventPath: text, optionPath: text, expectedSlotIdentity: text, delegation: trainingDelegation }, [], teamSession.get],
    ["set_team_training_session", "按游戏合法选项变更某日某时段训练，要求原始预览 token、未过去日期、可编辑状态。可显式选择仅本次/接管全部团队训练；全部接管时同时核对槽位配置和职责，避免同类型训练误报无需接管。", { monthPath: text, dayPath: text, eventPath: text, optionPath: text, expectedSlotIdentity: text, expectedChoiceToken: text, delegation: trainingDelegation, operationId: text }, ["dayPath", "eventPath", "optionPath", "expectedChoiceToken"], teamSession.set],
    ["get_team_training_session_state", "独立读取训练槽位的日期、时段和当前类型；可用 expectedSlotIdentity 防止日历重排误读。配置读回不代表训练已发生。", { monthPath: text, dayPath: text, eventPath: text, expectedSlotIdentity: text }, ["dayPath", "eventPath"], teamSession.state],
    ["get_team_training_schedules", "读取原生训练月份和周列表（teamType 可选 first/reserves/youth，默认 compact=true 返回周摘要避免244KB嵌套树，全量传 compact: false）；weekPath 后读取该周和类别，categoryPath 后读取合法计划，schedulePath 后预览。", { teamType: { type: "string", enum: ["first", "reserves", "youth"], default: "first" }, monthPath: text, weekPath: text, categoryPath: text, schedulePath: text, expectedDateFingerprint: text, delegation: trainingDelegation, compact: { type: "boolean", default: true } }, [], teamSchedule.get],
    ["set_team_training_week", "通过游戏正常整周计划事件应用合法训练安排（支持一线队/预备队/青年队，TRN-O29/O30）；默认尊重当前职责，可显式选择游戏的仅本次或接管全部团队训练。", { teamType: { type: "string", enum: ["first", "reserves", "youth"], default: "first" }, monthPath: text, weekPath: text, categoryPath: text, schedulePath: text, expectedDateFingerprint: text, expectedChoiceToken: text, delegation: trainingDelegation, operationId: text }, ["weekPath", "categoryPath", "schedulePath", "expectedChoiceToken"], teamSchedule.set],
    ["get_team_training_week_state", "重新订阅读取某个训练周的原生安排（支持 teamType），不读取存档文件。建议传 expectedDateFingerprint，防止日历滚动后观察错误周。", { teamType: { type: "string", enum: ["first", "reserves", "youth"], default: "first" }, monthPath: text, weekPath: text, expectedDateFingerprint: text }, ["weekPath"], teamSchedule.state],
    ["get_news_response_actions", "读取当前经理收件箱某条消息的实际回应选项、消息身份、标题和预览 token。默认完整收件箱；index 与 get_inbox 的 unreadOnly 必须对应。只开放已恢复的原生回应事件，其它动作注明缺口。", { index: { type: "integer", minimum: 0 }, unreadOnly: { type: "boolean", default: false }, bucket: { type: "string", enum: ["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"] }, expectedNewsIdentity: text }, ["index"], news.get],
    ["reply_to_news", "执行游戏当前提供的新闻回应，使用上次预览 token，直接进入原生业务处理。需要游戏确认时显式 acceptConfirmation；回执只证明派发，附带独立回应状态观察。", { index: { type: "integer", minimum: 0 }, unreadOnly: { type: "boolean", default: false }, bucket: { type: "string", enum: ["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"] }, actionIndex: { type: "integer", minimum: 0 }, expectedChoiceToken: text, expectedNewsIdentity: text, acceptConfirmation: { type: "boolean", default: false }, operationId: text }, ["index", "actionIndex", "expectedChoiceToken"], news.reply],
    ["get_news_response_state", "独立读取消息能否回应以及是否已回应。建议带 expectedNewsIdentity，防止列表重排后观察错误对象。不会读取玩家的回应内容。", { index: { type: "integer", minimum: 0 }, unreadOnly: { type: "boolean", default: false }, expectedNewsIdentity: text }, ["index"], news.state],
    ["get_news_read_state", "读取完整收件箱某条消息的原生已读状态和标读预览 token。必须提供 get_inbox(unreadOnly:false) 的 index 与 expectedNewsIdentity；不自动标读，不完成消息待办。", { index: { type: "integer", minimum: 0 }, expectedNewsIdentity: text, operationId: text }, ["index", "expectedNewsIdentity"], news.readState],
    ["get_related_news", "按原消息身份读取游戏提供的关联消息身份及附件所属消息身份。使用完整收件箱的下标。", { index: { type: "integer", minimum: 0 }, expectedNewsIdentity: text, limit: { type: "integer", minimum: 1, maximum: 64 } }, ["index", "expectedNewsIdentity"], news.relatedNews],
    ["set_news_read_state", "通过游戏原生事件 75 静默标记单条消息已读，或事件 138 标记未读（isRead:false）；不打开消息卡片、不改变最后打开消息。须原消息身份和预览 token；独立读回身份失配时拒绝观察。", { index: { type: "integer", minimum: 0 }, expectedNewsIdentity: text, expectedChoiceToken: text, isRead: { type: "boolean", enum: [true, false] }, operationId: text }, ["index", "expectedNewsIdentity", "expectedChoiceToken", "isRead"], news.setRead],
    ["get_transfer_structure_options", "读取报价类型或可新增费用/条款候选，提供 optionPath 可预览实际载荷 token；删除则预览真实条款引用。来源按游戏 metadata 在会话或 ClientContext 中解析。", { source: text, path: text, buyingClubSource: text, buyingClubPath: text, action: { type: "string", enum: ["add-clause", "remove-clause", "offer-type"] }, candidateProperty: text, optionPath: text, collection: text, clausePath: text }, ["source", "action"], structure.get],
    ["change_transfer_structure", "按游戏合法候选新增/删除费用或条款，或切换报价类型；需要预览 token。类型独立读回，增删只返回派发历史，避免用游戏可复用的下标误报成功。不提交报价。", { source: text, path: text, buyingClubSource: text, buyingClubPath: text, action: { type: "string", enum: ["add-clause", "remove-clause", "offer-type"] }, candidateProperty: text, optionPath: text, collection: text, clausePath: text, expectedChoiceToken: text, operationId: text }, ["source", "action", "expectedChoiceToken"], structure.execute],
    ["get_transfer_clauses", "读取真实转会/租借报价会话的费用与条款引用，返回可用于编辑的 clausePath。默认当前俱乐部买入；卖出需提供真实对方 buyingClubSource。", { source: text, path: text, buyingClubSource: text, buyingClubPath: text, collection: text }, ["source"], transfers.list],
    ["get_transfer_clause_value", "读取报价条款主/次/左右选项或金额及游戏合法列表。cashInput.ForeignValue.PropertyValue 是金额输入单位依据。", { source: text, path: text, buyingClubSource: text, buyingClubPath: text, collection: text, clausePath: text, kind: { type: "string", enum: ["primary", "secondary", "left-right", "cash"] } }, ["source", "clausePath", "kind"], transfers.get],
    ["stage_transfer_clause", "按原生条款选择事件或现金校验事件编辑转会/租借报价草稿，并独立读回；不提交报价。金额沿用游戏 ForeignValue 输入单位，允许游戏自身换算和限额。", { source: text, path: text, buyingClubSource: text, buyingClubPath: text, collection: text, clausePath: text, kind: { type: "string", enum: ["primary", "secondary", "left-right", "cash"] }, optionIndex: { type: "integer", minimum: 0 }, amount: text, expectedCurrent: text, expectedChoiceToken: text, operationId: text }, ["source", "clausePath", "kind"], transfers.set],
    ["get_negotiation_actions", "读取合同、转会/租借报价或签约前承诺谈判会话中当前可用的原生回应/提交动作及 choiceToken；本队球员可直接传 squadIndex 替代 source。", { domain: { type: "string", enum: ["contract", "transfer", "promises"] }, source: text, path: text, squadIndex: squadIdx, buyingClubSource: text, buyingClubPath: text, bucket: { type: "string", enum: ["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"] } }, ["domain"], negotiations.get],
    ["execute_negotiation_action", "执行合同、转会/租借报价或签约前承诺谈判动作（提交报价、还价、接受、拒绝、延迟、撤回或完成签约），需先调用 get_negotiation_actions 获取 actionIndex 与 expectedChoiceToken；本队球员可直接传 squadIndex 替代 source。", { domain: { type: "string", enum: ["contract", "transfer", "promises"] }, source: text, path: text, squadIndex: squadIdx, buyingClubSource: text, buyingClubPath: text, bucket: { type: "string", enum: ["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"] }, actionIndex: { type: "integer", minimum: 0 }, expectedChoiceToken: text, acceptConfirmation: { type: "boolean", default: false }, trackIncomingOffers: { type: "boolean", default: false }, operationId: text }, ["domain", "actionIndex", "expectedChoiceToken"], negotiations.execute],
    ["get_plugin_capabilities", "读取插件版本、二进制协议兼容性、主线程响应时间、当前实现/真机证据边界和未完成流程。进入游戏操作前先查询。", {}, [], () => call("/api/v1/capabilities")],
    ["get_contract_draft_start", "根据球员的原生 PersonOfferContract 菜单候选预览打开谈判草稿。entry 沿用 get_player_action_menu 的开始协商候选；本队球员可直接传 squadIndex 替代 source。", { source: text, path: text, squadIndex: squadIdx, entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 } }, ["entry"], actions.contractDraftPreview],
    ["open_contract_draft", "明确触发游戏原生合同草稿初始化或复用，核对谈判许可和可编辑性。使用原 entry、token 和操作号，合同提交另行执行；本队球员可直接传 squadIndex 替代 source。", { source: text, path: text, squadIndex: squadIdx, entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 }, expectedChoiceToken: text, operationId: text }, ["entry", "expectedChoiceToken", "operationId"], actions.openContractDraft],
    ["get_contract_term", "读取已打开合同草稿的类型、开始/结束日期，以及工资/忠诚奖金/经纪人费的原生合法选项。未开草稿先用 open_contract_draft；本队球员可直接传 squadIndex 替代 source。金额沿用游戏原始值及显示文字。", { source: text, path: text, squadIndex: squadIdx, kind: { type: "string", enum: ["contract-status", "start-date", "end-date", "wage", "loyalty-bonus", "agent-fee"] }, optionIndex: { type: "integer", minimum: 0 } }, ["kind"], contracts.get],
    ["input_contract_amount", "输入合同工资/忠诚奖金/经纪人费，调用游戏原生 ValidateCashValue 完成金额换算、取整和限额处理。amount 是游戏现金输入框 ForeignValue.PropertyValue 同单位的整数字符串，先读取 get_contract_term 的 cashInput。只编辑草稿，不提交合同；本队球员可直接传 squadIndex 替代 source。", { source: text, path: text, squadIndex: squadIdx, kind: { type: "string", enum: ["wage", "loyalty-bonus", "agent-fee"] }, amount: text, expectedCurrent: text, expectedChoiceToken: text, operationId: text }, ["kind", "amount"], contracts.inputAmount],
    ["stage_contract_term", "选择游戏提供的合同草稿条款/金额，核对当前值与选项 token；同一草稿被其它游戏绑定使用时拒绝编辑。只改草稿，随后独立订阅核对，不提交合同；本队球员可直接传 squadIndex 替代 source。", { source: text, path: text, squadIndex: squadIdx, kind: { type: "string", enum: ["contract-status", "start-date", "end-date", "wage", "loyalty-bonus", "agent-fee"] }, optionIndex: { type: "integer", minimum: 0 }, expectedCurrent: text, expectedChoiceToken: text, operationId: text }, ["kind", "optionIndex"], contracts.set],
    ["get_mentality_options", "读取当前心态及游戏提供的可选项。", {}, [], player.getMentalities],
    ["set_mentality", "使用游戏心态下拉选项执行命令并读回。", { mentality: text, ...operation }, ["mentality"], player.setMentality],
    ["get_team_instructions", "读取球队指令目录和当前设置；资源未加载时返回 unavailable，不打开页面。", { group: text }, [], a => player.getInstructions(a, "team")],
    ["set_team_instruction", "执行球队指令选项命令并读回。", { group: text, option: text, ...operation }, ["group", "option"], a => player.setInstruction(a, "team")],
    ["get_player_instructions", "读取首发槽位指令和角色锁定状态。", { ...slot, group: text }, ["selectionIndex"], a => player.getInstructions(a, "player")],
    ["set_player_instruction", "执行未锁定的球员指令命令并读回。", { ...slot, group: text, option: text, ...operation }, ["selectionIndex", "group", "option"], a => player.setInstruction(a, "player")],
    ["get_lineup_options", "读取 0..25 阵容槽位的原生球员候选、数据库标识及预览 token。0..10 为场上位置，其余槽位由比赛规则决定是否可用。variant 仅用于比赛中换人诊断：auto（默认）/pick/swap/swap-reversed，token 与 variant 绑定。", { selectionIndex: lineupSlot, variant: { type: "string", enum: ["auto", "pick", "swap", "swap-reversed"], description: "诊断用：选择比赛中换人派发的原生事件变体" } }, ["selectionIndex"], player.getLineupOptions],
    ["pick_lineup_player", "按游戏自己的选人事件载荷选择球员，并以持久化回执和独立订阅核对槽位草稿。比赛中仍不代表换人已上场。variant 必须与读取候选时一致。", { selectionIndex: lineupSlot, player: text, expectedPlayer: text, expectedChoiceToken: text, operationId: text, mutationCursor: { type: "integer", minimum: 0 }, variant: { type: "string", enum: ["auto", "pick", "swap", "swap-reversed"], description: "诊断用：与 get_lineup_options 相同的换人事件变体" } }, ["selectionIndex", "player"], player.pickPlayer],
    ["get_lineup_selection_state", "按原 operationId 重新订阅并核对指定阵容槽位；可用于写入失联后的只读恢复，不重发命令，不把草稿当成场上状态。", { selectionIndex: lineupSlot, operationId: text }, ["selectionIndex", "operationId"], player.lineupState],
    ["get_news_induction", "从原消息的 Induction.SpeakTo 读取真正引导状态和游戏提供的结束选项；不是消息外层的开始按钮。", inductionArgs, ["index", "expectedNewsIdentity"], induction.get],
    ["execute_news_induction_action", "通过当前引导原始结束候选执行业务事件；不打开面板，不改步骤或完成标志。执行后独立读取引导及当前必须事务。", inductionArgs, ["index", "expectedNewsIdentity", "actionIndex", "expectedChoiceToken", "operationId"], induction.execute],
    ["get_club_budget_balances", "实时读取当前俱乐部实际转会预算与工资预算，可用于对比预算分配前后的结果。", {}, [], manager.getClubBudgetBalances],
    ["get_budget_allocation", "读取当前预算分配会话的合法档位和可编辑状态。", {}, [], manager.getBudgetAllocation],
    ["stage_budget_allocation", "按合法滑杆档位调整预算草稿；不确认提交，不直接修改预算余额。", { index: { type: "integer", minimum: 0 }, ...operation }, ["index"], manager.stageBudgetAllocation],
    ["confirm_budget_allocation", "通过游戏自身确认事件提交当前俱乐部预算草稿；返回派发回执，实际预算生效还需重新读取财政数据。", { expectedConfirmationToken: text, operationId: text }, [], manager.confirmBudgetAllocation],
    ["read_manager_area", "按领域读取实时引用的相关属性，并列出缺少的上下文。", { area: { type: "string", enum: ["finance", "training", "recruitment", "transfers", "club", "match"] }, source: text, path: text, contexts: { type: "object" }, limit: { type: "integer", minimum: 1, maximum: 40 } }, ["area"], manager.readArea],
    ["get_player_actions", "查询游戏当前为一个真实球员引用提供的合法动作及静默执行支持状态。本队球员可直接传 squadIndex 替代 source。", { source: text, path: text, squadIndex: squadIdx }, [], actions.offered],
    ["get_player_action_initiation_catalog", "读取报价/合同初始化动作（PersonOfferContract/PersonApproachToSign）的原生 handler/dispatch 证据、静默执行状态与阻塞原因；只读目录，不发操作。", {}, [], actions.initiation],
    ["get_player_action_menu", "读取一个合法动作的原生菜单，entry 可预览具体子选项及载荷标记；本队球员可直接传 squadIndex 替代 source。", { source: text, path: text, squadIndex: squadIdx, action: text, entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 } }, ["action"], actions.menu],
    ["execute_player_action", "直接发送游戏菜单的原始载荷；目前仅开放已恢复协议的考察/短名单/试训等动作，确认流程或页面副作用未知时拒绝。回执只证明派发；本队球员可直接传 squadIndex 替代 source。", { source: text, path: text, squadIndex: squadIdx, action: text, entry: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 8 }, expectedChoiceToken: text, operationId: text }, ["action", "entry"], actions.execute],
    ["get_training_squad", "读取当前球队的球员及个人训练可用的 squadIndex。", {}, [], training.squad],
    ["get_individual_training", "读取球员当前个人训练设置、可编辑状态和游戏合法选项；提供 optionIndex 可预览具体选择。", { source: text, path: text, squadIndex: { type: "integer", minimum: 0 }, kind: { type: "string", enum: ["intensity", "focus", "position-role", "oop-role", "weaker-foot"] }, roleIndex: { type: "integer", minimum: 0 }, optionIndex: { type: "integer", minimum: 0 }, delegation: { type: "string", enum: ["respect", "take_control_this_player"], default: "respect" } }, ["kind"], args => args.kind === "weaker-foot" ? playerTrainingMenu.weakerFootState(args) : training.get(args)],
    ["set_individual_training", "按游戏选项设置强度/专项/持球位置角色/无球角色，保留原生上下文，重新订阅核对状态；可选择原生“接管此球员训练”操作处理责任委派。", { source: text, path: text, squadIndex: { type: "integer", minimum: 0 }, kind: { type: "string", enum: ["intensity", "focus", "position-role", "oop-role"] }, roleIndex: { type: "integer", minimum: 0 }, optionIndex: { type: "integer", minimum: 0 }, delegation: { type: "string", enum: ["respect", "take_control_this_player"], default: "respect" }, expectedCurrent: text, expectedChoiceToken: text, operationId: text }, ["kind", "optionIndex"], training.set],
    ["get_match_state", "读取当前比赛播放、执教、阶段和战术草稿状态，不切换页面。includeScore可读取同一比赛的实时主客队比分。", { includeScore: { type: "boolean" } }, [], match.state],
    ["get_match_live_report", "只读聚合当前比赛状态：播放/阶段/模拟/活动/战术草稿（可选），一次调用完成赛前与赛中信息读取；不派发任何比赛操作。高级统计与赛后事件详情请调用 get_match_team_stats_and_xg / get_match_player_live_stats / get_past_match_report。", { operationId: text, mutationCursor: { type: "integer", minimum: 0 }, tactic: text, pending: text, waiting: text, managerSide: { type: "boolean" } }, [], matchRead.get],
    ["get_on_pitch_players", "读取比赛原生 PlayerMatchStatsOnPitch 场上名单及球员数据库标识，列出解析不完整的行。", { isHomeTeam: { type: "boolean" } }, [], match.onPitch],
    ["preview_match_substitution", "预览一次普通比赛换人：实际场上槽位、原生替补、无既有草稿及播放策略。restore 仅在原来播放时恢复；leave_paused 保持暂停。返回计划 token，不执行。", { selectionIndex: slot.selectionIndex, player: text, playbackPolicy: { type: "string", enum: ["restore", "leave_paused"], default: "restore" } }, ["selectionIndex", "player"], substitution.preview],
    ["execute_match_substitution", "执行已预览换人，持久化父意图/阶段，必要时暂停，记录原生场上基线、选人读回、合法确认和播放恢复，再核对场上人员转换。未知结果停止且不重发，不自动取消用户草稿；成功也不宣称独占因果。", { selectionIndex: slot.selectionIndex, player: text, playbackPolicy: { type: "string", enum: ["restore", "leave_paused"], default: "restore" }, expectedPlanToken: text, operationId: text }, ["selectionIndex", "player", "expectedPlanToken"], substitution.execute],
    ["get_match_substitution_status", "读取持久化换人父状态和原生子回执；全部阶段完成后独立重订阅实际场上名单核验转换。只读游戏，可补充本地证据，不发送游戏操作。", { operationId: text }, ["operationId"], substitution.status],
    ["resume_match_substitution", "显式恢复原换人意图，必须提供原计划 token。已经启动的阶段仅用只读状态补证；不能证明完成则停止，不重发。只继续尚未启动阶段，并要求会话/比赛/客户端活动仍匹配。", { operationId: text, expectedPlanToken: text }, ["operationId", "expectedPlanToken"], substitution.resume],
    ["verify_match_substitution", "独立核对上下场球员是否已在原生场上名单中切换；不使用战术草稿作为换人生效证明。", { isHomeTeam: { type: "boolean" }, outgoingDatabaseIndex: { type: "integer", minimum: 0 }, incomingDatabaseIndex: { type: "integer", minimum: 0 } }, ["outgoingDatabaseIndex", "incomingDatabaseIndex"], match.verifySubstitution],
    ["set_match_playing", "通过游戏自身播放控制函数暂停或恢复同一场比赛。预览后可传 expectedMatchIdentity 拒绝切到另一场；恢复时游戏会照常关闭暂停面板。", { playing: { type: "boolean" }, expectedPlaying: { type: "boolean" }, expectedMatchIdentity: text, operationId: text, mutationCursor }, ["playing"], match.setPlaying],
    ["begin_match_changes", "向当前玩家比赛战术发出原生开始调整命令，不打开战术页面。data 为诊断用布尔：不传保持原空载荷。", { operationId: text, mutationCursor, data: { type: "boolean", description: "诊断：MakingTacticalChanges 的事件数据 true/false；不传为空" } }, [], match.begin],
    ["confirm_match_changes", "提交当前比赛战术草稿并核对草稿状态；不把该回执当作换人已上场的证明。", { expectedPending: { type: "boolean" }, operationId: text, mutationCursor }, [], match.confirm],
    ["cancel_match_changes", "按游戏规则取消当前比赛战术草稿并核对状态。", { expectedPending: { type: "boolean" }, operationId: text, mutationCursor }, [], match.cancel],
    ["get_club_finances_projection", "只读读取当前俱乐部净债务、转会债务与未来5年余额/支出/工资/转会预算及营业额预测（CLB-R04）。", {}, [], clubOverview.finances],
    ["get_club_facilities_and_youth", "只读读取俱乐部训练/青训/企业设施评级、青训招募等级、距下次青训招生天数及青训候选列表（CLB-R11/R16/SQU-R12）。", {}, [], clubOverview.facilities],
    ["get_club_confidence_and_culture", "只读读取董事会文化、球迷文化、球迷对董事会影响力、管理层支持反馈及月度支持度（CLB-R12）。", {}, [], clubOverview.confidence],
    ["get_club_history_and_overview", "只读读取俱乐部建队年份、简介、荣誉列表、名宿/偶像、附属俱乐部、青年队及职员空缺数（CLB-R15/R14）。", {}, [], clubOverview.history],
    ["get_squad_dynamics_and_hierarchy", "只读读取更衣室团队领袖与影响力层级人数、社交群体列表、社交反馈与比赛默契度反馈（SQU-R09）。", {}, [], clubOverview.dynamics],
    ["get_world_and_competitions", "只读读取今日赛程、最新比分赛事、近期5场赛程（含主客队与赛事名）、本队参赛赛事、全赛事近期状态及全球转会新闻（默认 compact=true 仅取前8条转会新闻防24KB膨胀，全量传 compact: false）。", { compact: { type: "boolean", default: true }, transferNewsLimit: { type: "integer", minimum: 1, maximum: 100, default: 8 } }, [], worldAndSquad.worldAndCompetitions],
    ["get_squad_compliance_and_contracts", "只读读取全赛事当前/潜在停赛名单与人数、一线队可用人数、下场资格规则、注册合规状态、即将到期合同与外租人数（SQU-R05/R17/R18）。", {}, [], worldAndSquad.complianceAndContracts],
    ["get_development_and_team_report", "只读读取发展中心一线队报告、评价星级、潜力评价及球队整体表现报告（TRN-R14/R19）。", {}, [], worldAndSquad.developmentReport],
    ["get_match_team_stats_and_xg", "只读读取直播比赛双方比分、进球名单、控球率、射门/射正、角球、犯规、观众与xG（默认不拉取巨型射门坐标数组，需坐标请传 includeShotMap: true）。", { includeShotMap: { type: "boolean", default: false } }, [], matchAnalytics.teamStatsAndXg],
    ["get_match_momentum_and_dugout", "只读读取直播比赛动量趋势数据点与总结、教练席实时事件提示时间线（MAT-R12/R29/R09）。", {}, [], matchAnalytics.momentumAndDugout],
    ["get_match_passing_network", "只读读取直播比赛双方传球分布与传球网络节点起止坐标（MAT-R19/R21）。", {}, [], matchAnalytics.passingNetwork],
    ["get_match_player_live_stats", "只读读取直播比赛双方场上球员评分、进球助攻、红黄牌、xG/xA、传球成功率、关键传球、防守与跑动数据（默认 side='both' 同时返回主客队、compact=true 省略全0冗余字段，需全量43项传 compact: false）。", { side: { type: "string", enum: ["home", "away", "both"], default: "both" }, limit: { type: "integer", minimum: 1, maximum: 25, default: 15 }, compact: { type: "boolean", default: true } }, [], matchAnalytics.playerLiveStats],
    ["get_match_player_heatmap", "只读读取直播比赛指定球员的热区图数据（MAT-R22）。", { side: { type: "string", enum: ["home", "away"], default: "home" }, playerIndex: { type: "integer", minimum: 0, maximum: 25, default: 0 } }, [], matchAnalytics.playerHeatMap],
    ["get_squad_snapshot", "一行一人紧凑阵容快照：一次读取全队（或分页）球员姓名、球衣号、年龄、位置、体能、锐度、士气、星级、薪资、合同到期与出场承诺，20人体积小于5KB且绝不触发订阅上限。", { offset: { type: "integer", minimum: 0, default: 0 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 30 }, includeContractAndStars: { type: "boolean", default: true } }, [], squadSnapshot.getSquadSnapshot],
    ["get_player_career_playing_time_and_reserves", "只读读取一线队指定球员的生涯履历、约定与实际出场时间、外租/租借合同详情（含对方承担工资、起止日、能否召回）、预备队出场授权及球探/教练优缺点报告（默认 compact=true 紧凑模式）。", { playerIndex: { type: "integer", minimum: 0, maximum: 60, default: 0 }, compact: { type: "boolean", default: true } }, [], playerScouting.playerCareerAndPlayingTime],
    ["get_scouting_knowledge_and_reports", "只读读取球探知识覆盖、已侦察球员数、短名单合约统计、球探空缺与已侦察球队报告（REC-R01/R03/CLB-R10）。", {}, [], playerScouting.scoutingKnowledgeAndReports],
    ["list_shortlists", "只读读取全部球员短名单及人数统计（REC-R06）。", {}, [], shortlists.listShortlists],
    ["create_shortlist", "静默新建球员短名单并独立读回校验列表增加（REC-O09a）。", { name: text, operationId: text }, ["name"], shortlists.createShortlist],
    ["rename_shortlist", "静默重命名指定球员短名单并独立读回校验名称变更（REC-O09b）。", { index: { type: "integer", minimum: 0 }, name: text, operationId: text }, ["index", "name"], shortlists.renameShortlist],
    ["delete_shortlist", "按索引静默删除非默认球员短名单并独立读回校验列表减少（REC-O09c）。", { index: { type: "integer", minimum: 0 }, operationId: text }, ["index"], shortlists.deleteShortlist],
    ["move_player_between_shortlists", "将球员在指定两个球员短名单之间切换移动（REC-O10c）。", { fromIndex: { type: "integer", minimum: 0, default: 0 }, toIndex: { type: "integer", minimum: 0 }, squadIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, ["toIndex"], shortlists.movePlayerBetweenShortlists],
    ["get_opposition_scout_report", "只读读取下一对手威胁评估、球队优缺点报告、已侦察对手球队列表与偏好阵型等元数据（TAC-R20/R21）。", { maxTeams: { type: "integer", minimum: 1, maximum: 10, default: 3 } }, [], oppositionReport.readOppositionReport],
    ["get_transfer_window_and_deadline", "只读读取当前转会窗口状态、截止日倒计时、是否加入截止日及转会窗头条动态（REC-R15）。", {}, [], seasonIntl.transferWindowAndDeadline],
    ["get_coaching_and_international_status", "只读读取教练资格等级、国脚集训与国际赛事状态、媒体预期排名及数据中心赛果下拉（TRN-R16/R21/MGR-R18）。", {}, [], seasonIntl.coachingAndInternationalStatus],
    ["get_competition_awards_and_stats", "只读读取本队指定参赛赛事的最佳阵容、月度/周度奖项、球员/球队统计榜、xG榜及抽签情况（MGR-R17/R10）。", { compIndex: { type: "integer", minimum: 0, default: 0 } }, [], compAwards.competitionAwardsAndStats],
    ["get_nations_and_international_overview", "只读读取国家页：可用国家队、大洲容器、活跃国家数及国际赛事规则组（MGR-R18）。", {}, [], compAwards.nationsAndInternationalOverview],
    ["compare_players", "只读横向比较 2~4 名一线队球员的年龄、位置、体能、士气、比赛状态、身价、薪资、身高体重与生涯荣誉（REC-R20）。", { playerIndices: { type: "array", items: { type: "integer", minimum: 0, maximum: 60 }, minItems: 2, maxItems: 4 } }, [], playerComparison.comparePlayers],
    ["get_datahub_analysis", "只读读取数据中心近五场优缺点统计、赛果下拉及最近一场比赛分析报告（默认 compact=true 防爆上下文，需全量传 compact: false；MAT-R24/R27）。", { analysisId: { type: "integer", minimum: 0, default: 0 }, compact: { type: "boolean", default: true } }, [], datahubTr.getDatahubAnalysis],
    ["get_transfer_room_adverts", "只读读取俱乐部 TransferRoom 已发布广告、应答列表与推荐球员（REC-R07）。", {}, [], datahubTr.getTransferRoomAdverts],
    ["get_squad_planner", "只读读取阵容规划器当前规划、助教排序选项与阵容短板摘要（SQU-R11/O10）。", { squadPlanType: { type: "integer", minimum: 0, default: 0 }, tacticIndex: { type: "integer", minimum: 0, default: 0 }, positionIndex: { type: "integer", minimum: 0, default: 0 }, showAllPositions: { type: "boolean", default: false } }, [], squadPlanner.readSquadPlanner],
    ["ask_assistant_squad_planner", "向阵容规划器发送采用助教排序建议（0位置/1战术/2赛季/3整体）并重新读回当前规划（SQU-O10d）。", { optionValue: { type: "integer", minimum: 0, maximum: 3, default: 3 }, operationId: text }, [], squadPlanner.askAssistant],
    ["edit_squad_planner_player", "在阵容规划器中移动或移除指定索引球员（SQU-O10b/c）。", { action: { type: "string", enum: ["move", "remove"], default: "remove" }, playerIndex: { type: "integer", minimum: 0, default: 0 }, targetPosition: { type: "integer", minimum: 0, default: 0 }, squadPlanType: { type: "integer", minimum: 0, default: 0 }, tacticIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], squadPlanner.editPlannerPlayer],
    ["list_job_adverts", "只读读取本俱乐部当前职员招聘广告、市场空缺职位与教练空缺（CLB-O13b / MGR-O14）。", {}, [], jobAdverts.listJobAdverts],
    ["remove_job_advert", "按索引静默撤销本俱乐部已发布的职员招聘广告并独立读回校验数量减少（CLB-O13b）。", { index: { type: "integer", minimum: 0 }, operationId: text }, ["index"], jobAdverts.removeJobAdvert],
    ["apply_for_job", "按工作中心市场广告索引提交职位申请（EventFmxApplyForJob，MGR-O14a）。", { index: { type: "integer", minimum: 0 }, operationId: text }, ["index"], jobAdverts.applyForJob],
    ["declare_interest_in_job", "按工作中心市场广告索引对空缺职位表达执教兴趣（EventFmxDeclareInterestInJob，MGR-O14b）。", { index: { type: "integer", minimum: 0 }, operationId: text }, ["index"], jobAdverts.declareInterestInJob],
    ["offer_staff_interview", "邀请职员空缺应聘者参加面试（EventFmxOfferJobInterview，CLB-O14b）。", { candidateIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], jobAdverts.offerStaffInterview],
    ["make_staff_contract_decision", "执行职员合同与任用决策（EventFmxMakeContractDecision，CLB-O15）。", { decisionIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], jobAdverts.makeStaffContractDecision],
    ["get_past_match_report", "只读读取历史比赛赛果列表、比赛报告摘要、集锦列表与球员战术评分数据（默认 compact=true 防爆上下文，需全量传 compact: false；MAT-R17）。", { fixtureIndex: { type: "integer", minimum: 0, default: 0 }, compact: { type: "boolean", default: true } }, [], pastMatchReport.getPastMatchReport],
    ["get_player_attributes", "只读聚合读取本队指定球员的技术/精神/身体/门将属性（自动分批防超时，兼容 squadIndex 与 playerIndex）。", { squadIndex: squadIdx, playerIndex: { type: "integer", minimum: 0, description: "与 squadIndex 等价的球员序号" }, categories: { type: "array", items: { type: "string", enum: ["technical", "mental", "physical", "goalkeeping"] }, default: ["technical", "mental", "physical"] }, customAttributes: { type: "array", items: text } }, [], playerAttrs.getPlayerAttributes],
    ["get_league_table_and_fixtures", "只读聚合当前联赛积分榜/排名与赛程（未来赛程及近期赛果）。", { limit: { type: "integer", minimum: 1, maximum: 30, default: 20 } }, [], playerAttrs.getLeagueTableAndFixtures],
    ["get_pre_match_briefing", "赛前一键简报（省 Token 聚合工具）：1 次调用汇总联赛名次、下场对手、当前心态、未读消息数与本队体能/士气预警名单，单次 < 4KB。", {}, [], playerAttrs.getPreMatchBriefing],
    ["get_cup_draw_state", "只读读取当前杯赛抽签自动运行状态与抽签速度设置（MGR-R10）。", {}, [], cupDrawLeague.getCupDrawState],
    ["control_cup_draw", "驱动杯赛抽签流程（open/start/next_team/next_pot/draw_all/pause，MGR-O13）。", { action: { type: "string", enum: ["open", "start", "next_team", "next_pot", "draw_all", "pause"], default: "draw_all" }, operationId: text }, [], cupDrawLeague.controlCupDraw],
    ["manage_playable_leagues", "增加、确认或撤销可玩联赛配置变更（add/confirm/undo，MGR-O24a/b）。", { action: { type: "string", enum: ["add", "confirm", "undo"], default: "confirm" }, leagueId: { type: "integer" }, optionPath: text, operationId: text }, [], cupDrawLeague.managePlayableLeagues],
    ["manage_team_scouting", "读取球探考察球队优先级列表，或优先/取消指定球队球探考察任务（read/prioritise/cancel，REC-O06a / REC-O07b）。", { action: { type: "string", enum: ["read", "prioritise", "cancel"], default: "read" }, teamIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], focusLifecycle.teamScouting],
    ["manage_fixture_scouting", "读取赛程并安排/修改对手与比赛考察分析任务（EventFmxHumanScoutFixture，REC-O30a/b）。", { action: { type: "string", enum: ["read", "scout"], default: "read" }, fixtureIndex: { type: "integer", minimum: 0 }, useNextFixture: { type: "boolean", default: true }, operationId: text }, [], focusLifecycle.scoutFixture],
    ["manage_scouting_centre_report", "读取球探中心待处理报告并执行确认/请求更新报告/继续考察（REC-O08c）。", { action: { type: "string", enum: ["read", "acknowledge", "request_update", "keep_scouting"], default: "read" }, durationDays: { type: "integer", minimum: 1 }, operationId: text }, [], focusLifecycle.scoutingCentreReport],
    ["manage_scouting_assignment", "读取赛事与地区可考察树及球探覆盖范围，支持调整球探范围、任务人员与短名单更新频率（REC-O06b/c / REC-O07a / REC-O31）。", { action: { type: "string", enum: ["read", "set_range", "confirm_staff", "set_interval"], default: "read" }, rangeValue: { type: "integer", minimum: 0 }, intervalValue: { type: "integer", minimum: 0 }, operationId: text }, [], focusLifecycle.scoutingAssignment],
    ["get_youth_intake_overview", "只读读取俱乐部青训评估等级、状态、位置预览及候选人排行（SQU-O16）。", {}, [], youthMedical.getYouthIntakeOverview],
    ["manage_youth_candidate", "在青训/青年队中调动或增删指定索引青训候选球员（SQU-O16a/c）。", { playerIndex: { type: "integer", minimum: 0, default: 0 }, add: { type: "boolean", default: true }, operationId: text }, [], youthMedical.manageYouthCandidate],
    ["get_player_injury_treatment", "只读读取一线队指定球员伤病状态、治疗方案与恢复体能（SQU-O12a）。", { squadIndex: { type: "integer", minimum: 0, default: 0 } }, [], youthMedical.getPlayerInjuryTreatment],
    ["manage_injury_treatment", "读取或执行活跃伤病球员的治疗方案（specialist/surgery/rest）与康复训练控制（rehab/resume_training/train_while_injured）（SQU-O12b/c/d / SQU-O13a/b/c）。", { squadIndex: { type: "integer", minimum: 0, default: 0 }, action: { type: "string", enum: ["read", "specialist", "surgery", "rest", "rehab", "resume_training", "train_while_injured"], default: "read" }, optionValue: { type: "integer", minimum: 0 }, operationId: text }, [], youthMedical.manageInjuryTreatment],
    ["manage_transfer_room_advert", "管理 TransferRoom 广告（选中/撤销/取消/提交非空广告草稿，REC-O11a/c）。", { action: { type: "string", enum: ["select", "delete", "cancel", "confirm"], default: "select" }, advertIndex: { type: "integer", minimum: 0, default: 0 }, draft: { type: "object", additionalProperties: true }, operationId: text }, [], datahubTr.manageTransferRoomAdvert],
    ["follow_player", "将指定一线队索引球员加入关注/收藏列表（EventFmxAddPlayerToFavourite，MGR-O23b）。", { squadIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], dofFollow.followPlayer],
    ["manage_dof_target_group", "创建、重命名或删除总监转会目标组（create/rename/delete）。", { action: { type: "string", enum: ["create", "rename", "delete"], default: "create" }, name: text, groupIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], dofFollow.manageDofTargetGroup],
    ["get_holiday_status", "只读读取当前经理是否处于休假状态、返岗时间及度假配置草稿。", {}, [], managerHoliday.getHolidayStatus],
    ["manage_holiday", "设置经理假期（go）或提前结束假期（return）并独立读回 IsOnHoliday 校验（MGR-O15d/e）。", { action: { type: "string", enum: ["go", "return"], default: "go" }, returnDateType: { type: "integer", minimum: 0 }, returnNumberDays: { type: "integer", minimum: 1 }, useCurrentTactics: { type: "boolean" }, useTeamSelection: { type: "boolean" }, applyForJobs: { type: "boolean" }, operationId: text }, [], managerHoliday.manageHoliday],
    ["search_players", "多条件搜索游戏球员数据库：传入 name 时优先通过原生 game.Search 毫秒级直达全库任意球员并返回 personIdentity；未传 name 时扫描球探数据库（HumanPersonSearch.PersonList）。支持按姓名、位置（中英文如 ST/DC/DM/门将）、年龄区间、国籍、俱乐部、仅自由球员、身高区间过滤与排序。", {
      name: text,
      position: text,
      minAge: { type: "integer", minimum: 14 },
      maxAge: { type: "integer", minimum: 14 },
      nationality: text,
      club: text,
      freeAgentOnly: { type: "boolean", default: false },
      minHeight: { type: "integer", minimum: 140 },
      maxHeight: { type: "integer", minimum: 140 },
      sortBy: { type: "string", enum: ["default", "age_asc", "age_desc", "height_desc"], default: "default" },
      scanLimit: { type: "integer", minimum: 1, maximum: 350, default: 150 },
      limit: { type: "integer", minimum: 1, maximum: 40, default: 15 },
      searchType: { type: "integer", minimum: 0, default: 1 }
    }, [], playerSearchFilter.searchPlayers],
    ["get_player_search_filter_options", "只读读取球员搜索管理选项及过滤器可用状态（REC-O29）。", {}, [], playerSearchFilter.getSearchFilterOptions],
    ["manage_player_search_filter", "保存（save）、重用载入（load）或删除/重置（delete/reset）保存的球员搜索过滤条件（REC-O29a/b/c）。", { action: { type: "string", enum: ["save", "load", "reset", "delete"], default: "save" }, scopeKind: { type: "string", enum: ["filter", "attributes", "conditions"], default: "filter" }, name: text, operationId: text }, [], playerSearchFilter.managePlayerSearchFilter],
    ["get_development_advice", "只读读取发展中心建议数据、会议状态与建议文本（TRN-O26）。", {}, [], developmentAdvice.getDevelopmentAdvice],
    ["action_development_plan", "执行发展中心计划建议（制定 apply / 更新 update / 结束 end，TRN-O26a/b/c）。", { action: { type: "string", enum: ["apply", "update", "end"], default: "apply" }, adviceIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], developmentAdvice.actionDevelopmentPlan],
    ["get_work_permit_status", "只读读取指定球员的工作许可资格、当前申请状态与未来申请预期反馈（REC-R16）。", { squadIndex: { type: "integer", minimum: 0, default: 0 } }, [], workPermitTrial.getWorkPermitStatus],
    ["manage_trial_lifecycle", "读取试训状态，并支持延长试训（extend）或结束试训（end）（REC-O13b/c）。", { squadIndex: { type: "integer", minimum: 0, default: 0 }, action: { type: "string", enum: ["read", "extend", "end"], default: "read" }, weeks: { type: "integer", minimum: 1, default: 1 }, operationId: text }, [], workPermitTrial.manageTrialLifecycle],
    ["handle_work_permit_or_medical", "读取并处理交易前置体检或工作许可申请/上诉（REC-O27a/b）。", { squadIndex: { type: "integer", minimum: 0, default: 0 }, action: { type: "string", enum: ["read", "apply_work_permit", "appeal_work_permit", "medical"], default: "read" }, operationId: text }, [], workPermitTrial.handleWorkPermitOrMedical],
    ["get_international_management_state", "只读读取国家队执教上下文、集训营状态与指令可用性（SQU-O17 / TRN-O28）。", {}, [], intlMgmt.getInternationalManagementState],
    ["manage_international_callup", "执行国家队征召、撤回征召或处理资格变更（带非国家队上下文门禁，SQU-O17a/b/c）。", { action: { type: "string", enum: ["call_up", "withdraw", "eligibility"], default: "call_up" }, playerIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], intlMgmt.manageInternationalCallup],
    ["manage_international_training_camp", "安排国家队集训指定日或应用集训计划（TRN-O28a/b）。", { action: { type: "string", enum: ["schedule_day", "apply_camp_plan"], default: "schedule_day" }, dayIndex: { type: "integer", minimum: 0, default: 0 }, scheduleIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], intlMgmt.manageInternationalTrainingCamp],
    ["get_negotiation_staff_advice", "读取或请求谈判中总监/职员即时建议（REC-R18）。", { requestDofOpinion: { type: "boolean", default: false }, operationId: text }, [], mlsAdvice.getNegotiationStaffAdvice],
    ["manage_mls_and_draft", "处理特殊联赛工资帽与名额调整及选秀（Draft）事务（REC-O28c/d）。", { action: { type: "string", enum: ["set_budget_adjustment", "cancel_budget_adjustment", "complete_draft", "redraft_timeout", "restart_shuffle_draft"], default: "set_budget_adjustment" }, value: { type: "integer", default: 0 }, operationId: text }, [], mlsAdvice.manageMlsAndDraft],
    ["manage_training_unit_membership", "手动将指定球员移入或移出训练分组单元（TRN-O25a/b）。", { squadIndex: { type: "integer", minimum: 0, default: 0 }, unit: { type: "string", enum: ["attacking", "defensive", "midfield", "goalkeeping"], default: "attacking" }, action: { type: "string", enum: ["add", "remove"], default: "add" }, operationId: text }, [], trainingUnits.manageMembership],
    ["offer_youth_contract_or_trial", "为青训候选球员提供青年/职业合同或安排青训试训（SQU-O16b/d）。", { playerIndex: { type: "integer", minimum: 0, default: 0 }, action: { type: "string", enum: ["youth_contract", "pro_contract", "trial"], default: "youth_contract" }, operationId: text }, [], youthMedical.offerYouthContractOrTrial],
    ["post_job_advert", "发布俱乐部职员空缺招聘广告（CLB-O13a）。", { roleId: { type: "integer", minimum: 0, default: 0 }, department: { type: "string", enum: ["coaching", "medical", "scouting"], default: "coaching" }, operationId: text }, [], jobAdverts.postJobAdvert],
    ["review_or_select_applicant", "审阅职员应聘者名单或选定拟聘职员（CLB-O14a/c）。", { action: { type: "string", enum: ["review", "select"], default: "review" }, candidateIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], jobAdverts.reviewOrSelectApplicant],
    ["promote_or_reassign_staff", "执行职员晋升或调岗（CLB-O15c/d）。", { action: { type: "string", enum: ["promote", "reassign"], default: "promote" }, staffIndex: { type: "integer", minimum: 0, default: 0 }, targetRoleId: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], jobAdverts.promoteOrReassignStaff],
    ["get_manager_career_status", "只读读取经理本人当前职务、求职次数与合同引用（MGR-O14 / MGR-O15）。", {}, [], managerCareer.getManagerCareerStatus],
    ["manage_manager_career", "处理经理面试/接受职位、本人合同/续约或带安全锁辞职（MGR-O14c/d / MGR-O15a/b/c）。", { action: { type: "string", enum: ["contract_read", "attend_interview", "accept_job", "negotiate_contract", "renew_contract", "resign"], default: "contract_read" }, jobIndex: { type: "integer", minimum: 0, default: 0 }, acceptResignConfirmation: { type: "boolean", default: false }, operationId: text }, [], managerCareer.manageManagerCareer],
    ["manage_news_follow", "关注或取消关注指定球队、赛事或新闻来源（MGR-O23a/c）。", { targetType: { type: "string", enum: ["club", "competition", "media_source"], default: "club" }, targetIndex: { type: "integer", minimum: 0, default: 0 }, follow: { type: "boolean", default: true }, operationId: text }, [], managerCareer.manageNewsFollow],
    ["manage_inbox_message_flags", "管理收件箱消息标记：重要/保留/设置提醒/归档（MGR-O04a/b/c/d）。", { index: { type: "integer", minimum: 0, default: 0 }, flag: { type: "string", enum: ["important", "keep", "reminder", "archive"], default: "important" }, value: { type: "boolean", default: true }, reminderDays: { type: "integer", minimum: 1, default: 1 }, operationId: text }, [], inboxFlagsPromises.manageInboxMessageFlags],
    ["submit_message_typed_input", "执行带日期或数值输入的交互消息待办（MGR-O06c/d）。", { index: { type: "integer", minimum: 0, default: 0 }, inputKind: { type: "string", enum: ["date", "numeric"], default: "numeric" }, numericValue: { type: "number" }, dateText: text, operationId: text }, [], inboxFlagsPromises.submitMessageTypedInput],
    ["manage_promise_or_happiness", "处理承诺履约问题或后续跟进对话（MGR-O12a/c）。", { action: { type: "string", enum: ["resolve", "follow_up"], default: "resolve" }, promiseIndex: { type: "integer", minimum: 0, default: 0 }, squadIndex: { type: "integer", minimum: 0, default: 0 }, operationId: text }, [], inboxFlagsPromises.managePromiseOrHappiness],
    ["optimize_best_xi", "确定性最优首发 11 人与 7 人替补席排阵算法（精确匈牙利最大权匹配，杜绝一人两用）：综合位置熟练度、体能、伤停、薪资层级与可选青训倾斜，毫秒级输出最佳首发与客串预警，大幅节省 Token。", {
      formation: { type: "string", enum: ["4-2-3-1", "4-3-3", "4-4-2", "3-5-2", "3-4-2-1", "4-1-4-1", "5-3-2", "4-4-2-diamond"], description: "阵型模板（不传则自动读取当前球队持球阵型）" },
      slots: { type: "array", items: text, minItems: 11, maxItems: 11, description: "自定义 11 槽位数组（如 ['GK','DR','DC',...]）" },
      minCondition: { type: "integer", minimum: 40, maximum: 100, default: 72, description: "健康体能门槛，低于此值强扣分促轮换" },
      preferYouth: { type: "boolean", default: false, description: "杯赛/练兵模式：为 U21/U23 小妖额外加分" },
      excludeIndices: { type: "array", items: { type: "integer", minimum: 0 }, uniqueItems: true, description: "手动排除轮休的 squadIndex 列表" }
    }, [], bestXi.optimizeBestXi],
    ["audit_squad_and_contracts", "确定性一线队体检算法：一键统计 6 大位置线深度缺口与冗员、年龄结构、体能/锐度异常、30+ 高薪老将与青训苗子，直接给出可执行引援/清洗/轮换建议。", {
      lowConditionThreshold: { type: "integer", minimum: 50, maximum: 95, default: 80 },
      lowSharpnessThreshold: { type: "integer", minimum: 40, maximum: 90, default: 65 }
    }, [], squadAudit.auditSquadAndContracts]
  ];
  return { tools: definitions.map(([name, description, properties, required]) => ({ name,
    description: experimental + description, inputSchema: schema(properties, required) })),
    handlers: Object.fromEntries(definitions.map(([name, , , , handler]) => [name, handler])) };
}
