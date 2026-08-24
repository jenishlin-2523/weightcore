/* ============================================================
   WeighCore — svt_weighbridge schema + seed
   Tables & columns mirror exactly what src/wb-query.ps1 reads
   and src/sqldb.js writes. Batches separated by GO.
   ============================================================ */

IF DB_ID('svt_weighbridge') IS NULL
    CREATE DATABASE svt_weighbridge;
GO

USE svt_weighbridge;
GO

/* ---------- master tables ---------- */
IF OBJECT_ID('dbo.Unit') IS NULL
CREATE TABLE dbo.Unit (
    UnitID   INT IDENTITY(1,1) PRIMARY KEY,
    UnitName NVARCHAR(50) NOT NULL
);
GO

IF OBJECT_ID('dbo.Template') IS NULL
CREATE TABLE dbo.Template (
    TemplateID   INT IDENTITY(1,1) PRIMARY KEY,
    TemplateName NVARCHAR(100) NOT NULL,
    Active       BIT NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('dbo.UserMaster') IS NULL
CREATE TABLE dbo.UserMaster (
    UserID     INT IDENTITY(1,1) PRIMARY KEY,
    UserName   NVARCHAR(100) NOT NULL,
    FirstName  NVARCHAR(100) NULL,
    LastName   NVARCHAR(100) NULL,
    Email      NVARCHAR(200) NULL,
    ContactNo  NVARCHAR(50)  NULL,
    TemplateID INT NULL,
    Salt       NVARCHAR(200) NULL,
    Active     BIT NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('dbo.Product') IS NULL
CREATE TABLE dbo.Product (
    ProductID       INT IDENTITY(1,1) PRIMARY KEY,
    ProductName     NVARCHAR(150) NOT NULL,
    ProductCode     NVARCHAR(50)  NULL,
    Notes           NVARCHAR(400) NULL,
    TransactionType NVARCHAR(20)  NULL,   -- Processing / Disposal / RDF / All (blank = all)
    IsActive        BIT NOT NULL DEFAULT 1
);
GO
IF COL_LENGTH('dbo.Product','TransactionType') IS NULL ALTER TABLE dbo.Product ADD TransactionType NVARCHAR(20) NULL;
GO

IF OBJECT_ID('dbo.Account') IS NULL
CREATE TABLE dbo.Account (
    AccountID     INT IDENTITY(1,1) PRIMARY KEY,
    AccountCode   NVARCHAR(50)  NULL,
    CompanyName   NVARCHAR(200) NULL,
    FirstName     NVARCHAR(100) NULL,
    LastName      NVARCHAR(100) NULL,
    ContactNo     NVARCHAR(50)  NULL,
    IsAccount     BIT NOT NULL DEFAULT 1,
    IsTransporter BIT NOT NULL DEFAULT 0,
    City          NVARCHAR(100) NULL,
    Active        BIT NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('dbo.Vehicle') IS NULL
CREATE TABLE dbo.Vehicle (
    VehicleID     INT IDENTITY(1,1) PRIMARY KEY,
    VehicleNumber NVARCHAR(50) NOT NULL,
    VehicleType   NVARCHAR(50) NULL,
    TareWeight    DECIMAL(18,3) NULL,
    AccountID     INT NULL,
    IsActive      BIT NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('dbo.Driver') IS NULL
CREATE TABLE dbo.Driver (
    DriverID  INT IDENTITY(1,1) PRIMARY KEY,
    FirstName NVARCHAR(100) NULL,
    LastName  NVARCHAR(100) NULL,
    IDProofNo NVARCHAR(100) NULL,
    AccountID INT NULL,
    Active    BIT NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('dbo.Gate') IS NULL
CREATE TABLE dbo.Gate (
    GateID   INT IDENTITY(1,1) PRIMARY KEY,
    GateName NVARCHAR(100) NOT NULL,
    GateType NVARCHAR(20)  NULL,
    IsActive BIT NOT NULL DEFAULT 1
);
GO

IF OBJECT_ID('dbo.WeightBridge') IS NULL
CREATE TABLE dbo.WeightBridge (
    WeightBridgeID INT IDENTITY(1,1) PRIMARY KEY,
    ScaleName      NVARCHAR(100) NULL,
    MaxCapacity    DECIMAL(18,3) NULL,
    UnitID         INT NULL,
    IsActive       BIT NOT NULL DEFAULT 1,
    COMPort        NVARCHAR(20)  NULL,
    BaudRate       INT NULL,
    DataBits       INT NULL,
    Parity         NVARCHAR(20)  NULL,
    StopBits       INT NULL
);
GO

/* ---------- transaction tables ---------- */
IF OBJECT_ID('dbo.TransactionData') IS NULL
CREATE TABLE dbo.TransactionData (
    TicketID           INT NOT NULL PRIMARY KEY,   -- allocated MAX+1 by the app, not IDENTITY
    VehicleID          INT NULL,
    DriverID           INT NULL,
    AccountID          INT NULL,
    TransporterID      INT NULL,
    Status             NVARCHAR(20) NULL,
    TransactionMode    NVARCHAR(20) NULL,
    TransactionType    NVARCHAR(20) NULL,
    PlantDirectionType NVARCHAR(20) NULL,
    ReceiptTicketID    UNIQUEIDENTIFIER NULL,
    Charges            DECIMAL(18,2) NULL,
    CreationTime       DATETIME NULL,
    CreatedBy          INT NULL,
    VehicleNumber      NVARCHAR(50)  NULL,
    DriverName         NVARCHAR(150) NULL,
    TransporterName    NVARCHAR(200) NULL,
    AccountName        NVARCHAR(200) NULL,
    CustomField1       NVARCHAR(200) NULL,   -- Vehicle Type
    CustomField2       NVARCHAR(200) NULL,   -- Party Name
    CustomField3       NVARCHAR(200) NULL,   -- Buyer Name
    CustomField4       NVARCHAR(200) NULL,   -- Package No
    CustomField5       NVARCHAR(200) NULL    -- Weighbridge No
);
GO
-- add the 5 custom fields to already-existing installs (idempotent)
IF COL_LENGTH('dbo.TransactionData','CustomField1') IS NULL ALTER TABLE dbo.TransactionData ADD CustomField1 NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.TransactionData','CustomField2') IS NULL ALTER TABLE dbo.TransactionData ADD CustomField2 NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.TransactionData','CustomField3') IS NULL ALTER TABLE dbo.TransactionData ADD CustomField3 NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.TransactionData','CustomField4') IS NULL ALTER TABLE dbo.TransactionData ADD CustomField4 NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.TransactionData','CustomField5') IS NULL ALTER TABLE dbo.TransactionData ADD CustomField5 NVARCHAR(200) NULL;
GO

IF OBJECT_ID('dbo.TransactionDetail') IS NULL
CREATE TABLE dbo.TransactionDetail (
    DetailID         INT IDENTITY(1,1) PRIMARY KEY,
    ReceiptTicketID  UNIQUEIDENTIFIER NULL,
    WeightBridgeID   INT NULL,
    SequenceNo       INT NULL,
    ProductID        INT NULL,
    GateID           INT NULL,
    WeighmentType    NVARCHAR(30) NULL,
    CaptureWeight    DECIMAL(18,3) NULL,
    CaptureTime      DATETIME NULL,
    GrossWeight      DECIMAL(18,3) NULL,
    GrossTime        DATETIME NULL,
    TareWeight       DECIMAL(18,3) NULL,
    TareTime         DATETIME NULL,
    NetWeight        DECIMAL(18,3) NULL,
    WeightUnit       NVARCHAR(20) NULL,
    UserID           INT NULL,
    UserName         NVARCHAR(100) NULL,
    WeighbridgeName  NVARCHAR(100) NULL,
    ProductName      NVARCHAR(150) NULL,
    GateName         NVARCHAR(100) NULL,
    IsTareManual     BIT NULL,
    IsGrossManual    BIT NULL,
    IsCapturedManual BIT NULL
);
GO
CREATE INDEX IX_TxnDetail_Receipt ON dbo.TransactionDetail(ReceiptTicketID);
GO

/* ---- weighment capture photos (2 per pass: one per camera) ---- */
IF OBJECT_ID('dbo.TransactionImage') IS NULL
CREATE TABLE dbo.TransactionImage (
    ImageID         UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    ScaleID         NVARCHAR(20)  NULL,
    ReceiptTicketID UNIQUEIDENTIFIER NULL,
    TicketID        INT NULL,
    CameraID        NVARCHAR(30)  NULL,
    Seq             INT NULL,           -- pass sequence (1 = first weighing, 2 = second)
    Kind            NVARCHAR(20)  NULL, -- Tare / Gross
    ImageData       VARBINARY(MAX) NULL,
    CreatedAt       DATETIME NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_TxnImg_Receipt' AND object_id=OBJECT_ID('dbo.TransactionImage'))
    CREATE INDEX IX_TxnImg_Receipt ON dbo.TransactionImage(ScaleID, ReceiptTicketID);
GO

/* ---------- seed reference data (idempotent) ---------- */
IF NOT EXISTS (SELECT 1 FROM dbo.Unit)
    INSERT INTO dbo.Unit (UnitName) VALUES (N'Kg'), (N'MT');
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Template)
    INSERT INTO dbo.Template (TemplateName, Active) VALUES
        (N'Administrator', 1),   -- TemplateID 1 -> R0 super admin
        (N'Operator',      1),   -- TemplateID 2 -> R3 operator
        (N'Supervisor',    1);   -- TemplateID 3 -> R1 administrator
GO

-- superadmin / Admin@123  (Salt = HMAC-SHA256('jm3UIgFC7CCQwqtr', 'superadmin'+'admin@123'))
IF NOT EXISTS (SELECT 1 FROM dbo.UserMaster WHERE LOWER(UserName)=N'superadmin')
    INSERT INTO dbo.UserMaster (UserName, FirstName, LastName, Email, ContactNo, TemplateID, Salt, Active)
    VALUES (N'superadmin', N'Super', N'Admin', N'super@chennaibiomining.in', N'9840000000', 1,
            N'C1aIcT4NEJevkJ772zKNT/03WlOVumykaOn144sS0KM=', 1);
GO

-- NOTE: the weighbridge row is created by the Setup wizard, named after THIS
-- terminal's Scale ID (P5WB1 or P5WB2). No weighbridge is seeded here, so each
-- install has exactly its own — never both.
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Product)
    INSERT INTO dbo.Product (ProductName, ProductCode, Notes, IsActive) VALUES
        (N'MSW - Municipal Solid Waste', N'MSW',   NULL, 1),
        (N'RDF - Refuse Derived Fuel',   N'RDF',   NULL, 1),
        (N'Inert / Soil',                N'INERT', NULL, 1);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Gate)
    INSERT INTO dbo.Gate (GateName, GateType, IsActive) VALUES (N'Main Gate', N'BOTH', 1);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Account)
    INSERT INTO dbo.Account (CompanyName, FirstName, LastName, ContactNo, IsAccount, IsTransporter, City, Active)
    VALUES (N'Chennai Transport Co', N'Ravi', N'Kumar', N'9840012345', 0, 1, N'Chennai', 1);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Vehicle)
    INSERT INTO dbo.Vehicle (VehicleNumber, VehicleType, TareWeight, AccountID, IsActive)
    VALUES (N'TN01AB1234', N'Tipper', 12000, 1, 1);
GO

PRINT 'WeighCore schema + seed complete.';
GO
