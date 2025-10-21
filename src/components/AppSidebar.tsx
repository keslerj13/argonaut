import { FileText, ExternalLink } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function AppSidebar() {
  return (
    <Sidebar className="border-r">
      <SidebarHeader className="p-4 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          <h2 className="font-semibold">CSV Converter Guide</h2>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="w-full">
              <SidebarGroupLabel className="text-base cursor-pointer hover:bg-muted/50 p-2 rounded flex items-center justify-between">
                <span>CSV Format Instructions</span>
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <SidebarGroupContent className="px-4 py-2 space-y-4 text-sm">
                {/* Template Link */}
                <div className="bg-primary/10 border border-primary/20 rounded-md p-3">
                  <a 
                    href="https://docs.google.com/spreadsheets/d/1eHB8OylIj0QKAsJkS2Zd1ymB4zDpEqAsdFwzvfuWNyE/edit?gid=1833284774#gid=1833284774"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-primary font-medium hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    <span>Download Template</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                {/* Column Structure */}
                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Column Structure</h4>
                  <div className="space-y-2 text-muted-foreground">
                    <div>
                      <strong className="text-foreground">Column 1: Nesting Schema</strong>
                      <p className="text-xs mt-1">Leave all rows below header columns blank</p>
                    </div>
                    <div>
                      <strong className="text-foreground">Column 2: declared_name</strong>
                      <p className="text-xs mt-1">
                        This is the unique identifying object key. All rows should contain no special characters or spaces — separate with underscores and dashes where necessary. 
                        Start unique object IDs with the <code className="bg-muted px-1 rounded">Manufacturer_ComponentType</code> (i.e. <code className="bg-muted px-1 rounded">Danfoss_EXV_...</code>)
                      </p>
                    </div>
                  </div>
                </div>

                {/* Row Structure */}
                <div>
                  <h4 className="font-semibold mb-2 text-foreground">Row Structure</h4>
                  <div className="space-y-2 text-muted-foreground">
                    <div>
                      <strong className="text-foreground">Data Types:</strong>
                      <p className="text-xs mt-1">
                        Row 1 should contain the data type on this column (i.e. string, real, array)
                      </p>
                    </div>
                    <div>
                      <strong className="text-foreground">Object:</strong>
                      <p className="text-xs mt-1">The highest-level object key</p>
                    </div>
                    <div>
                      <strong className="text-foreground">Nested_object(s):</strong>
                      <p className="text-xs mt-1">
                        Nest these as far as you need, each row will represent how far that data is nested in the JSON schema. 
                        Columns sharing the same hierarchy will share nesting groups.
                      </p>
                    </div>
                    <div>
                      <strong className="text-foreground">Component rows:</strong>
                      <p className="text-xs mt-1">
                        All rows after Nested_Object rows will be considered as component rows.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Example */}
                <div className="bg-muted/50 border rounded-md p-3">
                  <h4 className="font-semibold mb-2 text-foreground text-xs">Example Structure:</h4>
                  <pre className="text-xs overflow-x-auto">
{`Data Type Row
Object Row
nested_object_1
nested_object_2
Component Row 1
Component Row 2`}
                  </pre>
                </div>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
