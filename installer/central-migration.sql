/* Central-server migration: multi-bridge columns + natural-key indexes.
   Applied ON TOP of weighcore-schema.sql on the CENTRAL SQL only.
   Both weighbridge PCs push rows stamped with their ScaleID (P5WB1 / P5WB2);
   tickets are keyed (ScaleID, ReceiptTicketID) so the bridges never collide.
   Idempotent — safe to re-run. */

/* TicketID must NOT be unique on the central — both bridges can produce the
   same ticket number. The merge key is (ScaleID, ReceiptTicketID). */
DECLARE @pk sysname = (SELECT name FROM sys.key_constraints
                       WHERE parent_object_id = OBJECT_ID('dbo.TransactionData') AND type = 'PK');
IF @pk IS NOT NULL EXEC('ALTER TABLE dbo.TransactionData DROP CONSTRAINT [' + @pk + ']');
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Txn_TicketID' AND object_id = OBJECT_ID('dbo.TransactionData'))
  CREATE INDEX IX_Txn_TicketID ON dbo.TransactionData(TicketID);
GO

IF COL_LENGTH('dbo.TransactionData','ScaleID') IS NULL
  ALTER TABLE dbo.TransactionData ADD ScaleID NVARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.TransactionDetail','ScaleID') IS NULL
  ALTER TABLE dbo.TransactionDetail ADD ScaleID NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Txn_Scale_Receipt' AND object_id=OBJECT_ID('dbo.TransactionData'))
  CREATE INDEX IX_Txn_Scale_Receipt ON dbo.TransactionData(ScaleID, ReceiptTicketID);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Det_Scale_Receipt' AND object_id=OBJECT_ID('dbo.TransactionDetail'))
  CREATE INDEX IX_Det_Scale_Receipt ON dbo.TransactionDetail(ScaleID, ReceiptTicketID);
GO

/* natural-key lookup indexes used by the sync's master merge */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Vehicle_No' AND object_id=OBJECT_ID('dbo.Vehicle'))
  CREATE INDEX IX_Vehicle_No ON dbo.Vehicle(VehicleNumber);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Product_Name' AND object_id=OBJECT_ID('dbo.Product'))
  CREATE INDEX IX_Product_Name ON dbo.Product(ProductName);
GO
