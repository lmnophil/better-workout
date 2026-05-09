-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "startedFromRoutineDayId" TEXT;

-- CreateTable
CREATE TABLE "Routine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scheduleStyle" TEXT NOT NULL DEFAULT 'sequence',
    "lastCompletedPosition" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Routine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineDay" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "weekday" INTEGER,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineDayPendingSwap" (
    "id" TEXT NOT NULL,
    "routineDayId" TEXT NOT NULL,
    "outExerciseId" TEXT NOT NULL,
    "inExerciseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutineDayPendingSwap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Routine_userId_key" ON "Routine"("userId");

-- CreateIndex
CREATE INDEX "RoutineDay_routineId_idx" ON "RoutineDay"("routineId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDay_routineId_position_key" ON "RoutineDay"("routineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDay_routineId_weekday_key" ON "RoutineDay"("routineId", "weekday");

-- CreateIndex
CREATE INDEX "RoutineDayPendingSwap_routineDayId_idx" ON "RoutineDayPendingSwap"("routineDayId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDayPendingSwap_routineDayId_outExerciseId_key" ON "RoutineDayPendingSwap"("routineDayId", "outExerciseId");

-- CreateIndex
CREATE INDEX "WorkoutSession_startedFromRoutineDayId_idx" ON "WorkoutSession"("startedFromRoutineDayId");

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_startedFromRoutineDayId_fkey" FOREIGN KEY ("startedFromRoutineDayId") REFERENCES "RoutineDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineDay" ADD CONSTRAINT "RoutineDay_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineDay" ADD CONSTRAINT "RoutineDay_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineDayPendingSwap" ADD CONSTRAINT "RoutineDayPendingSwap_routineDayId_fkey" FOREIGN KEY ("routineDayId") REFERENCES "RoutineDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineDayPendingSwap" ADD CONSTRAINT "RoutineDayPendingSwap_outExerciseId_fkey" FOREIGN KEY ("outExerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineDayPendingSwap" ADD CONSTRAINT "RoutineDayPendingSwap_inExerciseId_fkey" FOREIGN KEY ("inExerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
