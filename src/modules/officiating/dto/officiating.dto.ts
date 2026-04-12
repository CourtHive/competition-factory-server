export class CreateOfficialRecordDto {
  personId!: string;
  providerId?: string;
  person?: any;
  extensions?: any[];
}

export class GetOfficialRecordDto {
  officialRecordId!: string;
}

export class ListOfficialRecordsDto {
  providerId?: string;
}

export class ExecuteOfficiatingMethodDto {
  officialRecordId!: string;
  method!: string;
  params?: any;
}
