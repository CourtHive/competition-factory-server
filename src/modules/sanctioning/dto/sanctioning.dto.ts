export class CreateSanctioningRecordDto {
  governingBodyId!: string;
  applicantProviderId?: string;
  applicant!: any;
  proposal!: any;
  sanctioningLevel?: string;
  sanctioningPolicy?: string;
  extensions?: any[];
}

export class GetSanctioningRecordDto {
  sanctioningId!: string;
}

export class ListSanctioningRecordsDto {
  providerId?: string;
}

export class ExecuteSanctioningMethodDto {
  sanctioningId!: string;
  method!: string;
  params?: any;
}

export class CheckCalendarConflictsDto {
  sanctioningId!: string;
}
