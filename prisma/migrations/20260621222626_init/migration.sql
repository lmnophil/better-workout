-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "prescription" TEXT,
    "metric" TEXT NOT NULL DEFAULT 'reps',
    "loadType" TEXT NOT NULL DEFAULT 'weight',
    "equipment" TEXT NOT NULL DEFAULT '[]',
    "primaryMuscles" TEXT NOT NULL,
    "secondaryMuscles" TEXT NOT NULL DEFAULT '[]',
    "videoUrl" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Exercise_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExerciseUserSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "restTimerSeconds" INTEGER,
    "weightIncrement" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExerciseUserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExerciseUserSettings_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "startedFromRoutineDayId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkoutSession_startedFromRoutineDayId_fkey" FOREIGN KEY ("startedFromRoutineDayId") REFERENCES "RoutineDay" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserVolumeTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "muscleId" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    CONSTRAINT "UserVolumeTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "restTimerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "restTimerSeconds" INTEGER NOT NULL DEFAULT 90,
    "restTimerSound" BOOLEAN NOT NULL DEFAULT true,
    "restTimerVibrate" BOOLEAN NOT NULL DEFAULT true,
    "defaultSetsPerExercise" INTEGER NOT NULL DEFAULT 3,
    "defaultWeightIncrement" REAL NOT NULL DEFAULT 5,
    "volumeTier" TEXT NOT NULL DEFAULT 'balanced',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkoutTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkoutTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserHiddenTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserHiddenTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserHiddenTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "poolId" TEXT,
    "plannedSets" INTEGER,
    "plannedReps" INTEGER,
    "plannedSeconds" INTEGER,
    "plannedWeight" REAL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateExercise_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TemplateExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TemplateExercise_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "TemplatePool" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplatePool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "pickCount" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TemplatePool_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER,
    "weight" REAL,
    "seconds" INTEGER,
    "notes" TEXT,
    "bandId" TEXT,
    CONSTRAINT "SetLog_bandId_fkey" FOREIGN KEY ("bandId") REFERENCES "Band" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SetLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SetLog_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Band" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Band_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Routine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scheduleStyle" TEXT NOT NULL DEFAULT 'sequence',
    "lastCompletedPosition" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Routine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoutineDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routineId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "weekday" INTEGER,
    "label" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoutineDay_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoutineDay_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoutineDayPendingSwap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routineDayId" TEXT NOT NULL,
    "outExerciseId" TEXT NOT NULL,
    "inExerciseId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoutineDayPendingSwap_routineDayId_fkey" FOREIGN KEY ("routineDayId") REFERENCES "RoutineDay" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoutineDayPendingSwap_outExerciseId_fkey" FOREIGN KEY ("outExerciseId") REFERENCES "Exercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoutineDayPendingSwap_inExerciseId_fkey" FOREIGN KEY ("inExerciseId") REFERENCES "Exercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoutineShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routineId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoutineShare_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareReviewer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "reviewerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShareReviewer_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "RoutineShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShareComment_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "RoutineShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareComment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "ShareReviewer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShareSuggestion_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "RoutineShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareSuggestion_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "ShareReviewer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareReaction_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "RoutineShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareReaction_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "ShareReviewer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_sessionToken_key" ON "AuthSession"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Exercise_ownerId_idx" ON "Exercise"("ownerId");

-- CreateIndex
CREATE INDEX "Exercise_module_idx" ON "Exercise"("module");

-- CreateIndex
-- MANUAL (re-apply after any migration regen): partial unique — only LIVE
-- customs are unique per owner, so a soft-deleted custom doesn't block
-- recreating a live one with the same name. Prisma's @@unique can't express the
-- WHERE clause. See prisma/CLAUDE.md → "Raw partial indexes".
CREATE UNIQUE INDEX "Exercise_ownerId_name_key" ON "Exercise"("ownerId", "name") WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "ExerciseUserSettings_userId_idx" ON "ExerciseUserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseUserSettings_userId_exerciseId_key" ON "ExerciseUserSettings"("userId", "exerciseId");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_date_idx" ON "WorkoutSession"("userId", "date");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_completedAt_idx" ON "WorkoutSession"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "WorkoutSession_startedFromRoutineDayId_idx" ON "WorkoutSession"("startedFromRoutineDayId");

-- CreateIndex
-- MANUAL (re-apply after any migration regen): partial unique — at most one
-- in-progress session per user, enforced at the DB level so two tabs can't each
-- create one. Prisma's @@unique can't express the WHERE clause. See
-- prisma/CLAUDE.md → "Raw partial indexes".
CREATE UNIQUE INDEX "WorkoutSession_userId_active_key" ON "WorkoutSession"("userId") WHERE "completedAt" IS NULL;

-- CreateIndex
CREATE INDEX "UserVolumeTarget_userId_idx" ON "UserVolumeTarget"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserVolumeTarget_userId_muscleId_key" ON "UserVolumeTarget"("userId", "muscleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

-- CreateIndex
CREATE INDEX "WorkoutTemplate_userId_idx" ON "WorkoutTemplate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutTemplate_userId_name_key" ON "WorkoutTemplate"("userId", "name");

-- CreateIndex
CREATE INDEX "UserHiddenTemplate_userId_idx" ON "UserHiddenTemplate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserHiddenTemplate_userId_templateId_key" ON "UserHiddenTemplate"("userId", "templateId");

-- CreateIndex
CREATE INDEX "TemplateExercise_templateId_position_idx" ON "TemplateExercise"("templateId", "position");

-- CreateIndex
CREATE INDEX "TemplateExercise_poolId_idx" ON "TemplateExercise"("poolId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateExercise_templateId_exerciseId_key" ON "TemplateExercise"("templateId", "exerciseId");

-- CreateIndex
CREATE INDEX "TemplatePool_templateId_idx" ON "TemplatePool"("templateId");

-- CreateIndex
CREATE INDEX "SetLog_sessionId_idx" ON "SetLog"("sessionId");

-- CreateIndex
CREATE INDEX "SetLog_sessionId_position_idx" ON "SetLog"("sessionId", "position");

-- CreateIndex
CREATE INDEX "SetLog_exerciseId_idx" ON "SetLog"("exerciseId");

-- CreateIndex
CREATE INDEX "SetLog_bandId_idx" ON "SetLog"("bandId");

-- CreateIndex
CREATE UNIQUE INDEX "SetLog_sessionId_exerciseId_setNumber_key" ON "SetLog"("sessionId", "exerciseId", "setNumber");

-- CreateIndex
CREATE INDEX "Band_userId_idx" ON "Band"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Band_userId_name_key" ON "Band"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Band_userId_position_key" ON "Band"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Routine_userId_key" ON "Routine"("userId");

-- CreateIndex
CREATE INDEX "RoutineDay_routineId_idx" ON "RoutineDay"("routineId");

-- CreateIndex
CREATE INDEX "RoutineDay_templateId_idx" ON "RoutineDay"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDay_routineId_position_key" ON "RoutineDay"("routineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDay_routineId_weekday_key" ON "RoutineDay"("routineId", "weekday");

-- CreateIndex
CREATE INDEX "RoutineDayPendingSwap_routineDayId_idx" ON "RoutineDayPendingSwap"("routineDayId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDayPendingSwap_routineDayId_outExerciseId_key" ON "RoutineDayPendingSwap"("routineDayId", "outExerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineShare_token_key" ON "RoutineShare"("token");

-- CreateIndex
CREATE INDEX "RoutineShare_routineId_idx" ON "RoutineShare"("routineId");

-- CreateIndex
CREATE INDEX "ShareReviewer_shareId_idx" ON "ShareReviewer"("shareId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareReviewer_shareId_reviewerKey_key" ON "ShareReviewer"("shareId", "reviewerKey");

-- CreateIndex
CREATE INDEX "ShareComment_shareId_targetType_targetId_idx" ON "ShareComment"("shareId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "ShareComment_reviewerId_idx" ON "ShareComment"("reviewerId");

-- CreateIndex
CREATE INDEX "ShareSuggestion_shareId_state_idx" ON "ShareSuggestion"("shareId", "state");

-- CreateIndex
CREATE INDEX "ShareSuggestion_shareId_targetType_targetId_idx" ON "ShareSuggestion"("shareId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "ShareSuggestion_reviewerId_idx" ON "ShareSuggestion"("reviewerId");

-- CreateIndex
CREATE INDEX "ShareReaction_shareId_targetType_targetId_idx" ON "ShareReaction"("shareId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareReaction_reviewerId_targetType_targetId_kind_key" ON "ShareReaction"("reviewerId", "targetType", "targetId", "kind");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
