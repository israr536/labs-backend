-- New laboratories should hide test method names unless explicitly enabled.
ALTER TABLE "Lab"
ALTER COLUMN "showMethodNames" SET DEFAULT false;
